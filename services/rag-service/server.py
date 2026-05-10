import hashlib
import json
import math
import os
import re
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
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "agno-local-hash-embedding")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "180"))
MAX_CHUNKS_PER_ATTACHMENT = int(os.getenv("RAG_MAX_CHUNKS_PER_ATTACHMENT", "80"))


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


class AgnoRagEngine:
    def __init__(self) -> None:
        self.agent = Agent(
            name="Metawurks RAG",
            description="Retrieves user-scoped document chunks for chat grounding.",
            knowledge_retriever=self.retrieve_for_agno,
            search_knowledge=True,
            markdown=True,
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
                        "embedding": local_embedding(chunk),
                        "embeddingModel": EMBEDDING_MODEL,
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
        query_embedding = local_embedding(query)
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
            relevance = float(chunk.get("score") or 0) + score_chunk(chunk, query_tokens) + vector_score * 20
            if relevance > 0:
                chunk["vectorScore"] = vector_score
                chunk["relevance"] = relevance
                ranked.append(chunk)

        ranked.sort(key=lambda item: item.get("relevance") or 0, reverse=True)
        return [public_chunk(chunk) for chunk in ranked[:safe_limit]]


engine = AgnoRagEngine()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            send_json(self, 200, {"ok": True, "service": SERVICE_NAME, "framework": "agno"})
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
