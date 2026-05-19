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
    from pymongo import MongoClient
except ImportError as error:
    raise SystemExit(
        "Missing Python dependency 'pymongo'. Run `python -m pip install -r services/rag-service/requirements.txt`."
    ) from error

try:
    from agno.agent import Agent
except ImportError as error:
    raise SystemExit(
        "Missing Python dependency 'agno'. Run `python -m pip install -r services/rag-service/requirements.txt`."
    ) from error


PORT = int(os.getenv("PORT", "4005"))
SERVICE_NAME = os.getenv("SERVICE_NAME", "rag-service")
MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB")
EMBEDDING_DIMENSIONS = int(os.getenv("RAG_EMBEDDING_DIMENSIONS", "768"))
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
LOCAL_EMBEDDING_MODEL = "local-hash-embedding"
LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://localhost:4004").rstrip("/")
EMBEDDING_TIMEOUT_MS = int(os.getenv("RAG_EMBEDDING_TIMEOUT_MS", "15000"))
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "180"))
MAX_CHUNKS_PER_ATTACHMENT = int(os.getenv("RAG_MAX_CHUNKS_PER_ATTACHMENT", "80"))
DEFAULT_CHAT_MODEL = os.getenv("RAG_CHAT_MODEL", "gemini-2.5-flash")
AGNO_RUN_TIMEOUT = int(os.getenv("RAG_RUN_TIMEOUT_SECONDS", "45"))


mongo_client: Optional[MongoClient] = None
database = None


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


def get_db():
    global mongo_client, database
    if not MONGO_URI:
        raise RuntimeError("MONGODB_URI is required")
    if mongo_client is None:
        mongo_client = MongoClient(MONGO_URI)
        database = mongo_client[DB_NAME] if DB_NAME else mongo_client.get_default_database()
        chunks = database["rag_chunks"]
        chunks.create_index([("userId", 1), ("threadId", 1), ("createdAt", -1)])
        chunks.create_index([("userId", 1), ("threadId", 1), ("attachmentId", 1)])
        chunks.create_index([("userId", 1), ("threadId", 1), ("embeddingModel", 1)])
        try:
            chunks.create_index([("chunkText", "text"), ("fileName", "text")])
        except Exception:
            pass
    return database


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


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    length = min(len(left), len(right))
    dot = sum(float(left[index] or 0) * float(right[index] or 0) for index in range(length))
    left_mag = math.sqrt(sum(float(left[index] or 0) ** 2 for index in range(length)))
    right_mag = math.sqrt(sum(float(right[index] or 0) ** 2 for index in range(length)))
    denominator = left_mag * right_mag
    return dot / denominator if denominator else 0.0


def chunk_text(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + CHUNK_SIZE, len(normalized))
        if end < len(normalized):
            boundaries = [
                normalized.rfind("\n", start, end),
                normalized.rfind(". ", start, end),
                normalized.rfind(" ", start, end),
            ]
            boundary = max(boundaries)
            if boundary > start + int(CHUNK_SIZE * 0.6):
                end = boundary + 1
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return chunks[:MAX_CHUNKS_PER_ATTACHMENT]


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


def score_chunk(chunk: dict[str, Any], query_tokens: list[str]) -> float:
    if not query_tokens:
        return 0.0
    chunk_tokens = set(chunk.get("tokenPreview") or tokenize(chunk.get("chunkText") or ""))
    score = 0.0
    filename = str(chunk.get("fileName") or "").lower()
    for token in query_tokens:
        if token in chunk_tokens:
            score += 3
        if token in filename:
            score += 2
    phrase = " ".join(query_tokens[:6])
    if phrase and phrase in str(chunk.get("chunkText") or "").lower():
        score += 8
    return score


def public_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(chunk.get("_id") or chunk.get("id") or ""),
        "userId": chunk.get("userId"),
        "threadId": chunk.get("threadId"),
        "attachmentId": chunk.get("attachmentId"),
        "fileName": chunk.get("fileName"),
        "fileType": chunk.get("fileType"),
        "fileSize": chunk.get("fileSize"),
        "chunkIndex": chunk.get("chunkIndex"),
        "chunkText": chunk.get("chunkText"),
        "text": chunk.get("chunkText"),
        "relevance": chunk.get("relevance"),
        "vectorScore": chunk.get("vectorScore"),
        "embeddingModel": chunk.get("embeddingModel"),
        "createdAt": chunk.get("createdAt"),
        "framework": "agno",
    }


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


class AgnoRagEngine:
    def __init__(self) -> None:
        self.agent = Agent(
            name="Metawurks RAG",
            description="Retrieves user-scoped document chunks for chat grounding.",
            knowledge_retriever=self.retrieve_for_agno,
            search_knowledge=True,
            markdown=True,
        )

    def build_answer_agent(
        self,
        model: str,
        user_id: str,
        thread_id: str,
        summary_mode: bool,
        attachment_ids: list[str],
    ) -> Agent:
        def scoped_retriever(query: str, agent: Optional[Agent] = None, num_documents: int = 8, **kwargs: Any):
            kwargs.pop("user_id", None)
            kwargs.pop("thread_id", None)
            kwargs.pop("summary_mode", None)
            kwargs.pop("attachment_ids", None)
            return self.retrieve_for_agno(
                query,
                agent=agent,
                num_documents=30 if summary_mode else num_documents,
                user_id=user_id,
                thread_id=thread_id,
                summary_mode=summary_mode,
                attachment_ids=attachment_ids,
                **kwargs,
            )

        return Agent(
            name="Metawurks RAG",
            model=agno_model(model),
            description="Answers questions using user-scoped uploaded document chunks.",
            instructions=[
                "Use retrieved document chunks when they are relevant.",
                "Ground the answer in the retrieved content and do not invent document details.",
                "If the retrieved chunks do not contain the answer, say what is missing.",
                "When chunks are available, do not say you cannot access the uploaded document.",
                "For summary requests, produce a clear summary from the available chunks.",
            ],
            knowledge_retriever=scoped_retriever,
            search_knowledge=True,
            add_search_knowledge_instructions=True,
            add_knowledge_to_context=True,
            markdown=True,
            retries=1,
        )

    def ingest(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        db = get_db()
        chunks = db["rag_chunks"]
        user_id = str(payload.get("userId") or "").strip()
        thread_id = str(payload.get("threadId") or "").strip()
        if not user_id or not thread_id:
            raise ValueError("Missing userId or threadId")

        message_id = str(payload.get("messageId") or "").strip()
        created_at = parse_datetime(payload.get("createdAt"))
        docs: list[dict[str, Any]] = []

        for attachment in payload.get("attachments") or []:
            text = str(attachment.get("text") or "")
            if not text:
                continue
            current_attachment_id = attachment_id(attachment)
            attachment_chunks = chunk_text(text)
            if not attachment_chunks:
                continue
            embeddings, embedding_model = embed_texts(attachment_chunks)
            chunks.delete_many({"userId": user_id, "threadId": thread_id, "attachmentId": current_attachment_id})
            for index, chunk in enumerate(attachment_chunks):
                docs.append(
                    {
                        "userId": user_id,
                        "threadId": thread_id,
                        "messageId": message_id,
                        "attachmentId": current_attachment_id,
                        "fileName": str(attachment.get("name") or "Attachment"),
                        "fileType": str(attachment.get("type") or ""),
                        "fileSize": int(attachment.get("size") or 0),
                        "chunkIndex": index,
                        "chunkText": chunk,
                        "tokenPreview": tokenize(chunk)[:80],
                        "embedding": embeddings[index],
                        "embeddingModel": embedding_model,
                        "embeddingDimensions": EMBEDDING_DIMENSIONS,
                        "createdAt": created_at,
                        "updatedAt": created_at,
                        "framework": "agno",
                    }
                )

        if docs:
            chunks.insert_many(docs)
        return [public_chunk(doc) for doc in docs]

    def retrieve_for_agno(
        self,
        query: str,
        agent: Optional[Agent] = None,
        num_documents: int = 5,
        **kwargs: Any,
    ) -> Optional[list[dict[str, Any]]]:
        results = self.search(
            user_id=str(kwargs.get("user_id") or ""),
            thread_id=str(kwargs.get("thread_id") or ""),
            query=query,
            limit=num_documents,
            summary_mode=bool(kwargs.get("summary_mode")),
            attachment_ids=kwargs.get("attachment_ids") or [],
        )
        return [
            {
                "content": chunk["chunkText"],
                "name": chunk["fileName"],
                "meta_data": {
                    "fileName": chunk["fileName"],
                    "chunkIndex": chunk["chunkIndex"],
                    "relevance": chunk["relevance"],
                    "vectorScore": chunk["vectorScore"],
                },
            }
            for chunk in results
        ]

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
        chunks = get_db()["rag_chunks"]
        base_query: dict[str, Any] = {"userId": user_id, "threadId": thread_id}
        if attachment_ids:
            base_query["attachmentId"] = {"$in": [str(value) for value in attachment_ids if str(value)]}

        if summary_mode:
            return [
                public_chunk(chunk)
                for chunk in chunks.find(base_query).sort([("attachmentId", 1), ("chunkIndex", 1)]).limit(safe_limit)
            ]

        query_tokens = list(dict.fromkeys(tokenize(query)))[:40]
        query_embeddings, query_embedding_model = embed_texts([query])
        query_embedding = query_embeddings[0] if query_embeddings else local_embedding(query)
        candidates: list[dict[str, Any]] = []

        if query_tokens:
            try:
                candidates = list(
                    chunks.find(
                        {**base_query, "$text": {"$search": " ".join(query_tokens)}},
                        {"score": {"$meta": "textScore"}},
                    )
                    .sort([("score", {"$meta": "textScore"})])
                    .limit(60)
                )
            except Exception:
                candidates = []

        if not candidates:
            candidates = list(chunks.find(base_query).sort("createdAt", -1).limit(500))

        ranked = []
        for chunk in candidates:
            vector_score = cosine_similarity(query_embedding, chunk.get("embedding") or [])
            if chunk.get("embeddingModel") and chunk.get("embeddingModel") != query_embedding_model:
                vector_score *= 0.5
            relevance = float(chunk.get("score") or 0) + score_chunk(chunk, query_tokens) + vector_score * 20
            if relevance > 0:
                chunk["vectorScore"] = vector_score
                chunk["relevance"] = relevance
                ranked.append(chunk)

        ranked.sort(key=lambda item: item.get("relevance") or 0, reverse=True)
        return [public_chunk(chunk) for chunk in ranked[:safe_limit]]

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

        agent = self.build_answer_agent(
            model=str(payload.get("model") or DEFAULT_CHAT_MODEL),
            user_id=user_id,
            thread_id=thread_id,
            summary_mode=summary_mode,
            attachment_ids=attachment_ids,
        )
        output = agent.run(
            message,
            user_id=user_id,
            session_id=thread_id,
            metadata={"framework": "agno", "threadId": thread_id},
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
        }


engine = AgnoRagEngine()


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
                    "embeddingModel": EMBEDDING_MODEL,
                    "embeddingFallback": LOCAL_EMBEDDING_MODEL,
                },
            )
            return
        send_json(self, 404, {"error": "Not Found", "service": SERVICE_NAME})

    def do_POST(self) -> None:
        try:
            payload = read_json(self)
            if self.path == "/ingest":
                chunks = engine.ingest(payload)
                send_json(self, 200, {"chunks": chunks, "count": len(chunks), "framework": "agno"})
                return
            if self.path == "/search":
                results = engine.search(
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
                result = engine.answer(payload)
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
    print(f"{SERVICE_NAME} listening on {PORT} with Agno RAG", flush=True)
    server.serve_forever()
