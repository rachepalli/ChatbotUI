import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

try:
    from agno.agent import Agent
    from agno.knowledge.embedder import Embedder
    from agno.knowledge.knowledge import Knowledge
    from agno.vectordb.search import SearchType
except ImportError as error:
    raise SystemExit(
        "Missing Python dependency 'agno'. Run `python -m pip install -r services/rag-service/requirements.txt`."
    ) from error


PORT = int(os.getenv("PORT", "4005"))
SERVICE_NAME = os.getenv("SERVICE_NAME", "rag-service")
MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB") or "myapp"
RAG_VECTOR_DB = os.getenv("RAG_VECTOR_DB", "auto").strip().lower()
RAG_TABLE_NAME = os.getenv("RAG_TABLE_NAME", "agno_rag_documents")
RAG_SCHEMA = os.getenv("RAG_SCHEMA", "ai")
RAG_DB_URL = os.getenv("RAG_DB_URL") or os.getenv("PGVECTOR_URL") or os.getenv("POSTGRES_URL")
EMBEDDING_DIMENSIONS = int(os.getenv("RAG_EMBEDDING_DIMENSIONS", "768"))
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
LOCAL_EMBEDDING_MODEL = "local-hash-embedding"
LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://localhost:4004").rstrip("/")
EMBEDDING_TIMEOUT_MS = int(os.getenv("RAG_EMBEDDING_TIMEOUT_MS", "15000"))
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
DEFAULT_CHAT_MODEL = os.getenv("RAG_CHAT_MODEL", "gemini-2.5-flash")
AGNO_RUN_TIMEOUT = int(os.getenv("RAG_RUN_TIMEOUT_SECONDS", "45"))
RAG_MAX_RESULTS = int(os.getenv("RAG_MAX_RESULTS", "10"))


def json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "__str__"):
        return str(value)
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


def send_json(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body, default=json_default).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw) if raw else {}


def normalize_text(value: str) -> str:
    text = re.sub(r"\r\n?", "\n", str(value or ""))
    text = re.sub(r"[\t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def tokenize(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]{3,}", str(value or "").lower())


def normalize_vector(values: list[float]) -> list[float]:
    vector = [float(values[index]) if index < len(values) else 0.0 for index in range(EMBEDDING_DIMENSIONS)]
    magnitude = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / magnitude for value in vector]


def local_embedding(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    for token in tokenize(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    return normalize_vector(vector)


def local_embedding_batch(texts: list[str]) -> tuple[list[list[float]], str]:
    return [local_embedding(text) for text in texts], LOCAL_EMBEDDING_MODEL


def service_embedding_batch(texts: list[str]) -> tuple[list[list[float]], str]:
    if not texts:
        return [], EMBEDDING_MODEL

    payload = json.dumps(
        {
            "texts": texts,
            "model": EMBEDDING_MODEL,
            "dimensions": EMBEDDING_DIMENSIONS,
            "timeoutMs": EMBEDDING_TIMEOUT_MS,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{LLM_SERVICE_URL}/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=max(1, EMBEDDING_TIMEOUT_MS / 1000)) as response:
            data = json.loads(response.read().decode("utf-8") or "{}")
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return local_embedding_batch(texts)

    embeddings = data.get("embeddings") if isinstance(data, dict) else None
    if not isinstance(embeddings, list) or len(embeddings) != len(texts):
        return local_embedding_batch(texts)

    return [normalize_vector(embedding) for embedding in embeddings], str(data.get("model") or EMBEDDING_MODEL)


def embed_texts(texts: list[str]) -> tuple[list[list[float]], str]:
    embeddings, model = service_embedding_batch(texts)
    if len(embeddings) == len(texts):
        return embeddings, model
    return local_embedding_batch(texts)


class LlmServiceEmbedder(Embedder):
    def __init__(self) -> None:
        super().__init__(dimensions=EMBEDDING_DIMENSIONS)

    def get_embedding(self, text: str) -> list[float]:
        embeddings, _model = embed_texts([text])
        return embeddings[0] if embeddings else local_embedding(text)

    def get_embedding_and_usage(self, text: str) -> tuple[list[float], Optional[dict[str, Any]]]:
        return self.get_embedding(text), {"model": EMBEDDING_MODEL, "dimensions": EMBEDDING_DIMENSIONS}

    async def async_get_embedding(self, text: str) -> list[float]:
        return self.get_embedding(text)

    async def async_get_embedding_and_usage(self, text: str) -> tuple[list[float], Optional[dict[str, Any]]]:
        return self.get_embedding_and_usage(text)


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def attachment_id(attachment: dict[str, Any]) -> str:
    existing = str(attachment.get("attachmentId") or "").strip()
    if existing:
        return existing
    source = f"{attachment.get('name')}:{attachment.get('size')}:{attachment.get('type')}:{attachment.get('text')}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def normalize_chat_model(model: str) -> str:
    value = str(model or "").strip()
    aliases = {
        "gemini-2.5": "gemini-2.5-flash",
        "gemini-2.0": "gemini-2.5-flash-lite",
        "gemini-2.0-flash": "gemini-2.5-flash-lite",
        "gemini-lite": "gemini-2.5-flash-lite",
        "llama70b": "llama-70b",
        "llama-70b-ollama": "ollama:llama3.3:70b",
        "ollama:llama70b": "ollama:llama3.3:70b",
    }
    return aliases.get(value, value or DEFAULT_CHAT_MODEL)


def agno_model(model: str):
    normalized = normalize_chat_model(model)
    if normalized.startswith("ollama:"):
        try:
            from agno.models.ollama import Ollama
        except ImportError as error:
            raise RuntimeError("Missing Python dependency 'ollama'. Install rag-service requirements.") from error
        host = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        return Ollama(id=normalized.replace("ollama:", "") or os.getenv("OLLAMA_MODEL", "llama3.2"), host=host)

    if "gemini" in normalized:
        try:
            from agno.models.google import Gemini
        except ImportError as error:
            raise RuntimeError("Missing Python dependency 'google-genai'. Install rag-service requirements.") from error
        api_key = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        return Gemini(id=normalized, api_key=api_key, timeout=AGNO_RUN_TIMEOUT)

    try:
        from agno.models.groq import Groq
    except ImportError as error:
        raise RuntimeError("Missing Python dependency 'groq'. Install rag-service requirements.") from error
    mapped = "llama-3.1-8b-instant" if normalized == "llama-8b" else "llama-3.3-70b-versatile"
    return Groq(id=mapped, api_key=os.getenv("GROQ_API_KEY"), timeout=AGNO_RUN_TIMEOUT)


def run_content(output: Any) -> str:
    if hasattr(output, "get_content_as_string"):
        return str(output.get_content_as_string() or "").strip()
    if hasattr(output, "content"):
        return str(output.content or "").strip()
    return str(output or "").strip()


def run_usage(output: Any) -> dict[str, Any]:
    metrics = getattr(output, "metrics", None)
    if not metrics:
        return {}
    if hasattr(metrics, "to_dict"):
        try:
            return metrics.to_dict()
        except Exception:
            return {}
    return {}


def vector_db_kind() -> str:
    if RAG_VECTOR_DB in {"pgvector", "postgres", "postgresql"}:
        return "pgvector"
    if RAG_VECTOR_DB in {"mongodb", "mongo"}:
        return "mongodb"
    if RAG_DB_URL:
        return "pgvector"
    return "mongodb"


def build_vector_db(embedder: Embedder):
    kind = vector_db_kind()
    if kind == "pgvector":
        if not RAG_DB_URL:
            raise RuntimeError("RAG_DB_URL is required when RAG_VECTOR_DB=pgvector")
        try:
            from agno.vectordb.pgvector import PgVector
        except ImportError as error:
            raise RuntimeError(
                "Missing PgVector dependencies. Install sqlalchemy, psycopg, and pgvector."
            ) from error
        return PgVector(
            table_name=RAG_TABLE_NAME,
            schema=RAG_SCHEMA,
            db_url=RAG_DB_URL,
            embedder=embedder,
            search_type=SearchType.hybrid,
            vector_score_weight=0.75,
        )

    if not MONGO_URI:
        raise RuntimeError("MONGODB_URI is required when RAG_VECTOR_DB=mongodb")
    try:
        from agno.vectordb.mongodb import MongoDb
    except ImportError as error:
        raise RuntimeError("Missing MongoDB vector dependencies. Install pymongo.") from error
    return MongoDb(
        collection_name=RAG_TABLE_NAME,
        db_url=MONGO_URI,
        database=DB_NAME,
        embedder=embedder,
        search_type=SearchType.vector,
        wait_until_index_ready_in_seconds=float(os.getenv("RAG_MONGO_INDEX_WAIT_SECONDS", "3")),
        wait_after_insert_in_seconds=float(os.getenv("RAG_MONGO_INSERT_WAIT_SECONDS", "0")),
    )


def metadata_filter(user_id: str, thread_id: str, attachment_ids: Optional[list[str]] = None) -> dict[str, Any]:
    filters: dict[str, Any] = {"userId": user_id, "threadId": thread_id}
    ids = [str(value) for value in attachment_ids or [] if str(value)]
    if len(ids) == 1:
        filters["attachmentId"] = ids[0]
    return filters


def public_document(document: Any, index: int = 0) -> dict[str, Any]:
    meta = dict(getattr(document, "meta_data", None) or {})
    return {
        "id": str(getattr(document, "id", None) or meta.get("id") or ""),
        "userId": meta.get("userId"),
        "threadId": meta.get("threadId"),
        "attachmentId": meta.get("attachmentId"),
        "fileName": meta.get("fileName") or getattr(document, "name", None),
        "fileType": meta.get("fileType"),
        "fileSize": meta.get("fileSize"),
        "chunkIndex": int(meta.get("chunkIndex") or index),
        "chunkText": getattr(document, "content", "") or "",
        "text": getattr(document, "content", "") or "",
        "relevance": meta.get("similarity_score") or meta.get("score"),
        "vectorScore": meta.get("similarity_score") or meta.get("score"),
        "embeddingModel": meta.get("embeddingModel") or EMBEDDING_MODEL,
        "createdAt": meta.get("createdAt"),
        "framework": "agno",
    }


class AgnoRagEngine:
    def __init__(self) -> None:
        self.embedder = LlmServiceEmbedder()
        self.knowledge = Knowledge(
            name="Metawurks RAG",
            description="User-scoped document knowledge for Metawurks chat.",
            vector_db=build_vector_db(self.embedder),
            max_results=RAG_MAX_RESULTS,
        )

    def build_answer_agent(self, model: str) -> Agent:
        return Agent(
            name="Metawurks RAG",
            model=agno_model(model),
            description="Answers questions using user-scoped uploaded document knowledge.",
            instructions=[
                "Use retrieved document chunks when they are relevant.",
                "Ground the answer in the retrieved content and do not invent document details.",
                "If the retrieved chunks do not contain the answer, say what is missing.",
                "When chunks are available, do not say you cannot access the uploaded document.",
                "For summary requests, produce a clear summary from the available chunks.",
            ],
            knowledge=self.knowledge,
            search_knowledge=True,
            add_search_knowledge_instructions=True,
            add_knowledge_to_context=True,
            markdown=True,
            retries=1,
        )

    def ingest(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        user_id = str(payload.get("userId") or "").strip()
        thread_id = str(payload.get("threadId") or "").strip()
        if not user_id or not thread_id:
            raise ValueError("Missing userId or threadId")

        message_id = str(payload.get("messageId") or "").strip()
        created_at = parse_datetime(payload.get("createdAt")).isoformat()
        stored: list[dict[str, Any]] = []

        for attachment in payload.get("attachments") or []:
            text = normalize_text(str(attachment.get("text") or ""))
            if not text:
                continue

            current_attachment_id = attachment_id(attachment)
            file_name = str(attachment.get("name") or "Attachment")
            metadata = {
                "userId": user_id,
                "threadId": thread_id,
                "messageId": message_id,
                "attachmentId": current_attachment_id,
                "fileName": file_name,
                "fileType": str(attachment.get("type") or ""),
                "fileSize": int(attachment.get("size") or 0),
                "embeddingModel": EMBEDDING_MODEL,
                "embeddingDimensions": EMBEDDING_DIMENSIONS,
                "createdAt": created_at,
                "updatedAt": created_at,
                "framework": "agno",
            }

            self.knowledge.remove_vectors_by_metadata(
                {"userId": user_id, "threadId": thread_id, "attachmentId": current_attachment_id}
            )
            self.knowledge.insert(
                name=file_name,
                text_content=text,
                metadata=metadata,
                upsert=True,
            )
            stored.append(
                {
                    "id": current_attachment_id,
                    "userId": user_id,
                    "threadId": thread_id,
                    "attachmentId": current_attachment_id,
                    "fileName": file_name,
                    "fileType": metadata["fileType"],
                    "fileSize": metadata["fileSize"],
                    "chunkIndex": 0,
                    "chunkText": text[:CHUNK_SIZE],
                    "text": text[:CHUNK_SIZE],
                    "embeddingModel": EMBEDDING_MODEL,
                    "createdAt": created_at,
                    "framework": "agno",
                }
            )

        return stored

    def search(
        self,
        user_id: str,
        thread_id: str,
        query: str,
        limit: int = 6,
        summary_mode: bool = False,
        attachment_ids: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        if not user_id or not thread_id:
            raise ValueError("Missing userId or threadId")
        safe_limit = min(max(int(limit or 6), 1), 40)
        ids = [str(value) for value in attachment_ids or [] if str(value)]
        max_results = safe_limit if len(ids) <= 1 else min(80, safe_limit * 8)
        documents = self.knowledge.search(
            query="summary" if summary_mode and not query else query,
            max_results=max_results,
            filters=metadata_filter(user_id, thread_id, ids),
        )
        chunks = [public_document(document, index) for index, document in enumerate(documents)]
        if len(ids) > 1:
            id_set = set(ids)
            chunks = [chunk for chunk in chunks if str(chunk.get("attachmentId") or "") in id_set]
        return chunks[:safe_limit]

    def answer(self, payload: dict[str, Any]) -> dict[str, Any]:
        user_id = str(payload.get("userId") or "").strip()
        thread_id = str(payload.get("threadId") or "").strip()
        message = str(payload.get("message") or "").strip()
        if not user_id or not thread_id:
            raise ValueError("Missing userId or threadId")
        if not message:
            raise ValueError("Missing message")

        stored_chunks = self.ingest(payload) if payload.get("attachments") else []
        attachment_ids = [
            str(attachment.get("attachmentId") or attachment_id(attachment))
            for attachment in payload.get("attachments") or []
            if str(attachment.get("text") or "").strip()
        ]
        summary_mode = bool(payload.get("summaryMode"))
        limit = 30 if summary_mode else int(payload.get("limit") or 8)
        query = str(payload.get("query") or message).strip()
        sources = self.search(
            user_id=user_id,
            thread_id=thread_id,
            query=query,
            limit=limit,
            summary_mode=summary_mode,
            attachment_ids=attachment_ids,
        )

        agent = self.build_answer_agent(model=str(payload.get("model") or DEFAULT_CHAT_MODEL))
        output = agent.run(
            message,
            user_id=user_id,
            session_id=thread_id,
            metadata={"framework": "agno", "threadId": thread_id},
            knowledge_filters=metadata_filter(user_id, thread_id, attachment_ids),
        )
        reply = run_content(output)
        if not reply:
            raise RuntimeError("Agno did not return a response")

        return {
            "reply": reply,
            "model": getattr(output, "model", None) or normalize_chat_model(str(payload.get("model") or DEFAULT_CHAT_MODEL)),
            "usage": run_usage(output),
            "sources": sources,
            "storedChunks": len(stored_chunks),
            "framework": "agno",
            "vectorDb": vector_db_kind(),
        }


engine: Optional[AgnoRagEngine] = None


def get_engine() -> AgnoRagEngine:
    global engine
    if engine is None:
        engine = AgnoRagEngine()
    return engine


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": SERVICE_NAME,
                    "framework": "agno",
                    "ragMode": "knowledge",
                    "vectorDb": vector_db_kind(),
                    "tableName": RAG_TABLE_NAME,
                    "embeddingModel": EMBEDDING_MODEL,
                    "embeddingFallback": LOCAL_EMBEDDING_MODEL,
                },
            )
            return
        send_json(self, 404, {"error": "Not Found", "service": SERVICE_NAME})

    def do_POST(self) -> None:
        try:
            payload = read_json(self)
            rag_engine = get_engine()
            if self.path == "/ingest":
                chunks = rag_engine.ingest(payload)
                send_json(self, 200, {"chunks": chunks, "count": len(chunks), "framework": "agno"})
                return
            if self.path == "/search":
                results = rag_engine.search(
                    user_id=str(payload.get("userId") or "").strip(),
                    thread_id=str(payload.get("threadId") or "").strip(),
                    query=str(payload.get("query") or "").strip(),
                    limit=int(payload.get("limit") or 8),
                    summary_mode=bool(payload.get("summaryMode")),
                    attachment_ids=payload.get("attachmentIds") or [],
                )
                send_json(self, 200, {"results": results, "framework": "agno"})
                return
            if self.path == "/answer":
                result = rag_engine.answer(payload)
                send_json(self, 200, result)
                return
            send_json(self, 404, {"error": "Not Found", "service": SERVICE_NAME})
        except json.JSONDecodeError:
            send_json(self, 400, {"error": "Invalid JSON body", "service": SERVICE_NAME})
        except ValueError as error:
            send_json(self, 400, {"error": str(error), "service": SERVICE_NAME})
        except Exception as error:
            send_json(self, 500, {"error": str(error), "service": SERVICE_NAME})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("", PORT), Handler)
    print(f"{SERVICE_NAME} listening on {PORT} with Agno Knowledge RAG ({vector_db_kind()})", flush=True)
    server.serve_forever()
