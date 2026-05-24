import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from time import monotonic
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

try:
    from agno.agent import Agent
    from agno.knowledge.document import Document
    from agno.knowledge.embedder import Embedder
    from agno.knowledge.knowledge import Knowledge
    from agno.vectordb.base import VectorDb
    from agno.vectordb.search import SearchType
except ImportError as error:
    raise SystemExit(
        "Missing Python dependency 'agno'. Run `python -m pip install -r services/rag-service/requirements.txt`."
    ) from error


PORT = int(os.getenv("PORT", "4005"))
SERVICE_NAME = os.getenv("SERVICE_NAME", "rag-service")
MONGO_URI = os.getenv("MONGODB_DIRECT_URI") or os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB") or "myapp"
RAG_VECTOR_DB = os.getenv("RAG_VECTOR_DB", "auto").strip().lower()
RAG_TABLE_NAME = os.getenv("RAG_TABLE_NAME", "agno_rag_documents")
RAG_RESPONSE_CHUNKS_NAME = os.getenv("RAG_RESPONSE_CHUNKS_NAME", f"{RAG_TABLE_NAME}_response_chunks")
RAG_MONGO_SEARCH_INDEX_NAME = os.getenv("RAG_MONGO_SEARCH_INDEX_NAME", "vector_index_1")
RAG_SCHEMA = os.getenv("RAG_SCHEMA", "ai")
RAG_DB_URL = os.getenv("RAG_DB_URL") or os.getenv("PGVECTOR_URL") or os.getenv("POSTGRES_URL")
RAG_MEMORY_FALLBACK = os.getenv("RAG_MEMORY_FALLBACK", "1").strip().lower() not in {"0", "false", "no", "off"}
EMBEDDING_DIMENSIONS = int(os.getenv("RAG_EMBEDDING_DIMENSIONS", "768"))
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
LOCAL_EMBEDDING_MODEL = "local-hash-embedding"
LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://localhost:4004").rstrip("/")
EMBEDDING_TIMEOUT_MS = int(os.getenv("RAG_EMBEDDING_TIMEOUT_MS", "15000"))
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
DEFAULT_CHAT_MODEL = os.getenv("RAG_CHAT_MODEL") or "gemini-2.5-flash"
RAG_FALLBACK_CHAT_MODELS = [
    model.strip()
    for model in os.getenv("RAG_FALLBACK_CHAT_MODELS", "gemini-2.5-flash-lite,gemini-2.5-flash").split(",")
    if model.strip()
]
AGNO_RUN_TIMEOUT = int(os.getenv("RAG_RUN_TIMEOUT_SECONDS", "45"))
RAG_MAX_RESULTS = int(os.getenv("RAG_MAX_RESULTS", "10"))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "6"))
RAG_SUMMARY_TOP_K = int(os.getenv("RAG_SUMMARY_TOP_K", "8"))
RAG_SUMMARY_MAX_CHUNKS = int(os.getenv("RAG_SUMMARY_MAX_CHUNKS", "24"))
RAG_SUMMARY_CHUNK_CHARS = int(os.getenv("RAG_SUMMARY_CHUNK_CHARS", "1400"))
ACTIVE_VECTOR_DB_KIND: Optional[str] = None
MONGO_UNAVAILABLE_UNTIL = 0.0
MONGO_RETRY_SECONDS = int(os.getenv("RAG_MONGO_RETRY_SECONDS", "60"))


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
    text = text.replace("\ufffd", " ")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", " ", text)
    text = re.sub(r"[\t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_answer_text(value: str) -> str:
    text = normalize_text(value)
    text = re.sub(r"[ \t]+-[ \t]+", "-", text)
    text = re.sub(r"(?<=\w)-[ \t]+(?=\w)", "", text)
    text = re.sub(r"\b([A-Z])[ \t]+(?=[A-Z]\b)", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def clean_source_text(value: str) -> str:
    text = normalize_text(value)
    text = re.sub(r"[^\x09\x0a\x0d\x20-\x7e]", " ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def is_readable_source_text(value: str) -> bool:
    text = clean_source_text(value)
    if not text:
        return False

    words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", text)
    word_chars = sum(len(word) for word in words)
    if len(text) < 80:
        return len(words) >= 4 and word_chars / max(len(text), 1) >= 0.32

    symbols = re.findall(r"[^A-Za-z0-9\s\.,;:!?'\"()\[\]{}\/\\\-\+*&%#=@<>|`~^]", text)
    repeated_tiny_tokens = re.findall(r"\b([A-Za-z]{1,2})\b(?:\s+\1\b){4,}", text)
    return (
        len(words) >= 8
        and word_chars / max(len(text), 1) >= 0.28
        and len(symbols) / max(len(text), 1) <= 0.03
        and not repeated_tiny_tokens
    )


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


class LocalMongoVectorDb(VectorDb):
    def __init__(
        self,
        collection_name: str,
        db_url: str,
        database: str,
        embedder: Embedder,
    ) -> None:
        super().__init__(name="LocalMongoVectorDb")
        try:
            from pymongo import MongoClient
        except ImportError as error:
            raise RuntimeError("Missing MongoDB vector dependencies. Install pymongo.") from error

        self.collection_name = collection_name
        self.embedder = embedder
        self.client = MongoClient(db_url, serverSelectionTimeoutMS=5000)
        self.database = self.client[database]
        self.collection = self.database[collection_name]

    def create(self) -> None:
        self.collection.create_index([("content_hash", 1)])
        self.collection.create_index([("content_id", 1)])
        self.collection.create_index([("name", 1)])
        self.collection.create_index([("meta_data.userId", 1), ("meta_data.threadId", 1), ("meta_data.attachmentId", 1)])

    async def async_create(self) -> None:
        self.create()

    def exists(self) -> bool:
        return self.collection_name in self.database.list_collection_names()

    async def async_exists(self) -> bool:
        return self.exists()

    def name_exists(self, name: str) -> bool:
        return self.collection.find_one({"name": name}, {"_id": 1}) is not None

    async def async_name_exists(self, name: str) -> bool:
        return self.name_exists(name)

    def id_exists(self, id: str) -> bool:
        return self.collection.find_one({"_id": id}, {"_id": 1}) is not None

    def content_hash_exists(self, content_hash: str) -> bool:
        return self.collection.find_one({"content_hash": content_hash}, {"_id": 1}) is not None

    def _record_id(self, content_hash: str, document: Document) -> str:
        base = document.id or hashlib.md5(document.content.encode("utf-8")).hexdigest()
        return hashlib.md5(f"{base}:{content_hash}".encode("utf-8")).hexdigest()

    def _metadata_query(self, filters: Optional[dict[str, Any]]) -> dict[str, Any]:
        query: dict[str, Any] = {}
        for key, value in (filters or {}).items():
            query[f"meta_data.{key}"] = value
        return query

    def _prepare_record(self, content_hash: str, document: Document, filters: Optional[dict[str, Any]]) -> dict[str, Any]:
        document.embed(embedder=self.embedder)
        meta_data = dict(document.meta_data or {})
        if filters:
            meta_data.update(filters)
        content = document.content.replace("\x00", "\ufffd")
        return {
            "_id": self._record_id(content_hash, document),
            "name": document.name,
            "content": content,
            "meta_data": meta_data,
            "embedding": document.embedding,
            "usage": document.usage,
            "content_id": document.content_id,
            "content_hash": content_hash,
        }

    def insert(self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None) -> None:
        records = [self._prepare_record(content_hash, document, filters) for document in documents]
        if records:
            self.collection.insert_many(records, ordered=False)

    async def async_insert(
        self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None
    ) -> None:
        self.insert(content_hash, documents, filters)

    def upsert_available(self) -> bool:
        return True

    def upsert(self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None) -> None:
        for document in documents:
            record = self._prepare_record(content_hash, document, filters)
            self.collection.update_one({"_id": record["_id"]}, {"$set": record}, upsert=True)

    async def async_upsert(
        self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None
    ) -> None:
        self.upsert(content_hash, documents, filters)

    def search(self, query: str, limit: int = 5, filters: Optional[Any] = None) -> list[Document]:
        if not isinstance(filters, dict):
            filters = None
        query_embedding = self.embedder.get_embedding(query)
        candidates = self.collection.find(self._metadata_query(filters)).limit(1000)
        ranked: list[tuple[float, Document]] = []
        for item in candidates:
            score = cosine_similarity(query_embedding, item.get("embedding") or [])
            meta_data = dict(item.get("meta_data") or {})
            meta_data["similarity_score"] = score
            ranked.append(
                (
                    score,
                    Document(
                        id=str(item.get("_id") or ""),
                        name=item.get("name"),
                        content=item.get("content") or "",
                        meta_data=meta_data,
                        embedding=item.get("embedding"),
                        content_id=item.get("content_id"),
                    ),
                )
            )
        ranked.sort(key=lambda value: value[0], reverse=True)
        return [document for score, document in ranked[:limit] if score > 0]

    async def async_search(self, query: str, limit: int = 5, filters: Optional[Any] = None) -> list[Document]:
        return self.search(query, limit, filters)

    def delete(self) -> bool:
        self.collection.delete_many({})
        return True

    def drop(self) -> None:
        self.collection.drop()

    async def async_drop(self) -> None:
        self.drop()

    def delete_by_id(self, id: str) -> bool:
        self.collection.delete_one({"_id": id})
        return True

    def delete_by_name(self, name: str) -> bool:
        self.collection.delete_many({"name": name})
        return True

    def delete_by_metadata(self, metadata: dict[str, Any]) -> bool:
        self.collection.delete_many(self._metadata_query(metadata))
        return True

    def delete_by_content_id(self, content_id: str) -> bool:
        self.collection.delete_many({"content_id": content_id})
        return True

    def get_supported_search_types(self) -> list[str]:
        return [SearchType.vector.value]


class MemoryVectorDb(VectorDb):
    def __init__(self, embedder: Embedder) -> None:
        super().__init__(name="MemoryVectorDb")
        self.embedder = embedder
        self.records: dict[str, dict[str, Any]] = {}

    def create(self) -> None:
        return None

    async def async_create(self) -> None:
        self.create()

    def exists(self) -> bool:
        return True

    async def async_exists(self) -> bool:
        return self.exists()

    def name_exists(self, name: str) -> bool:
        return any(record.get("name") == name for record in self.records.values())

    async def async_name_exists(self, name: str) -> bool:
        return self.name_exists(name)

    def id_exists(self, id: str) -> bool:
        return id in self.records

    def content_hash_exists(self, content_hash: str) -> bool:
        return any(record.get("content_hash") == content_hash for record in self.records.values())

    def _record_id(self, content_hash: str, document: Document) -> str:
        base = document.id or hashlib.md5(document.content.encode("utf-8")).hexdigest()
        return hashlib.md5(f"{base}:{content_hash}".encode("utf-8")).hexdigest()

    def _matches_filters(self, meta_data: dict[str, Any], filters: Optional[Any]) -> bool:
        if not isinstance(filters, dict):
            return True
        return all(meta_data.get(key) == value for key, value in filters.items())

    def _prepare_record(self, content_hash: str, document: Document, filters: Optional[dict[str, Any]]) -> dict[str, Any]:
        document.embed(embedder=self.embedder)
        meta_data = dict(document.meta_data or {})
        if filters:
            meta_data.update(filters)
        return {
            "id": self._record_id(content_hash, document),
            "name": document.name,
            "content": document.content.replace("\x00", "\ufffd"),
            "meta_data": meta_data,
            "embedding": document.embedding,
            "usage": document.usage,
            "content_id": document.content_id,
            "content_hash": content_hash,
        }

    def insert(self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None) -> None:
        self.upsert(content_hash, documents, filters)

    async def async_insert(
        self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None
    ) -> None:
        self.insert(content_hash, documents, filters)

    def upsert_available(self) -> bool:
        return True

    def upsert(self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None) -> None:
        for document in documents:
            record = self._prepare_record(content_hash, document, filters)
            self.records[record["id"]] = record

    async def async_upsert(
        self, content_hash: str, documents: list[Document], filters: Optional[dict[str, Any]] = None
    ) -> None:
        self.upsert(content_hash, documents, filters)

    def search(self, query: str, limit: int = 5, filters: Optional[Any] = None) -> list[Document]:
        query_embedding = self.embedder.get_embedding(query)
        ranked: list[tuple[float, Document]] = []
        for record in self.records.values():
            meta_data = dict(record.get("meta_data") or {})
            if not self._matches_filters(meta_data, filters):
                continue
            score = cosine_similarity(query_embedding, record.get("embedding") or [])
            meta_data["similarity_score"] = score
            ranked.append(
                (
                    score,
                    Document(
                        id=str(record.get("id") or ""),
                        name=record.get("name"),
                        content=record.get("content") or "",
                        meta_data=meta_data,
                        embedding=record.get("embedding"),
                        content_id=record.get("content_id"),
                    ),
                )
            )
        ranked.sort(key=lambda value: value[0], reverse=True)
        return [document for score, document in ranked[:limit] if score > 0]

    async def async_search(self, query: str, limit: int = 5, filters: Optional[Any] = None) -> list[Document]:
        return self.search(query, limit, filters)

    def delete(self) -> bool:
        self.records.clear()
        return True

    def drop(self) -> None:
        self.records.clear()

    async def async_drop(self) -> None:
        self.drop()

    def delete_by_id(self, id: str) -> bool:
        self.records.pop(id, None)
        return True

    def delete_by_name(self, name: str) -> bool:
        ids = [record_id for record_id, record in self.records.items() if record.get("name") == name]
        for record_id in ids:
            self.records.pop(record_id, None)
        return True

    def delete_by_metadata(self, metadata: dict[str, Any]) -> bool:
        ids = [
            record_id
            for record_id, record in self.records.items()
            if self._matches_filters(dict(record.get("meta_data") or {}), metadata)
        ]
        for record_id in ids:
            self.records.pop(record_id, None)
        return True

    def delete_by_content_id(self, content_id: str) -> bool:
        ids = [
            record_id
            for record_id, record in self.records.items()
            if str(record.get("content_id") or "") == str(content_id)
        ]
        for record_id in ids:
            self.records.pop(record_id, None)
        return True

    def get_supported_search_types(self) -> list[str]:
        return [SearchType.vector.value]


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
        "openai": "gpt-4.1-mini",
        "openai-mini": "gpt-4.1-mini",
        "gemini-2.5": "gemini-2.5-flash",
        "gemini-2.0": "gemini-2.5-flash-lite",
        "gemini-2.0-flash": "gemini-2.5-flash-lite",
        "gemini-lite": "gemini-2.5-flash-lite",
        "llama70b": "llama-70b",
        "llama-70b-ollama": "ollama:llama3.3:70b",
        "ollama:llama70b": "ollama:llama3.3:70b",
    }
    return aliases.get(value, value or DEFAULT_CHAT_MODEL)


def rag_model_candidates(primary_model: str) -> list[str]:
    candidates: list[str] = []
    for model in [primary_model, *RAG_FALLBACK_CHAT_MODELS]:
        normalized = normalize_chat_model(model)
        if normalized and normalized not in candidates:
            candidates.append(normalized)
    return candidates


def agno_model(model: str):
    normalized = normalize_chat_model(model)
    if normalized.startswith(("gpt-", "o")):
        try:
            from agno.models.openai import OpenAIChat
        except ImportError as error:
            raise RuntimeError("Missing Python dependency 'openai'. Install rag-service requirements.") from error
        return OpenAIChat(id=normalized, api_key=os.getenv("OPENAI_API_KEY"), timeout=AGNO_RUN_TIMEOUT)

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
        return clean_answer_text(str(output.get_content_as_string() or ""))
    if hasattr(output, "content"):
        return clean_answer_text(str(output.content or ""))
    return clean_answer_text(str(output or ""))


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


def llm_service_generate(prompt: str, model: str, timeout_ms: int = 30000) -> tuple[str, str, dict[str, Any]]:
    payload = json.dumps(
        {
            "message": prompt,
            "model": normalize_chat_model(model or DEFAULT_CHAT_MODEL),
            "timeoutMs": timeout_ms,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{LLM_SERVICE_URL}/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=max(1, timeout_ms / 1000)) as response:
        data = json.loads(response.read().decode("utf-8") or "{}")

    if data.get("error"):
        message = data.get("error", {}).get("message") or "LLM service returned an error"
        raise RuntimeError(str(message))

    text = str(data.get("message") or "").strip()
    if not text:
        raise RuntimeError("LLM service returned an empty response")

    return text, str(data.get("model") or model or DEFAULT_CHAT_MODEL), dict(data.get("usage") or {})


def vector_db_kind() -> str:
    if RAG_VECTOR_DB in {"memory", "in-memory", "local-memory"}:
        return "memory"
    if RAG_VECTOR_DB in {"pgvector", "postgres", "postgresql"}:
        return "pgvector"
    if RAG_VECTOR_DB in {"atlas", "mongodb-atlas", "mongo-atlas"}:
        return "mongodb-atlas"
    if RAG_VECTOR_DB in {"mongodb", "mongo", "local-mongo", "local-mongodb"}:
        return "local-mongodb"
    if RAG_DB_URL:
        return "pgvector"
    return "local-mongodb"


def memory_vector_db(embedder: Embedder, reason: Optional[str] = None) -> MemoryVectorDb:
    global ACTIVE_VECTOR_DB_KIND
    ACTIVE_VECTOR_DB_KIND = "memory"
    if reason:
        print(f"{SERVICE_NAME} using in-memory RAG vector DB fallback: {reason}", flush=True)
    return MemoryVectorDb(embedder=embedder)


def verify_mongodb_connection(db_url: str, database: str) -> None:
    try:
        from pymongo import MongoClient
    except ImportError as error:
        raise RuntimeError("Missing MongoDB vector dependencies. Install pymongo.") from error

    client = MongoClient(db_url, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000)
    try:
        client[database].command("ping")
    finally:
        client.close()


def mongo_available() -> bool:
    return bool(MONGO_URI) and monotonic() >= MONGO_UNAVAILABLE_UNTIL


def mark_mongo_unavailable() -> None:
    global MONGO_UNAVAILABLE_UNTIL
    MONGO_UNAVAILABLE_UNTIL = monotonic() + max(MONGO_RETRY_SECONDS, 1)


def build_vector_db(embedder: Embedder):
    global ACTIVE_VECTOR_DB_KIND
    kind = vector_db_kind()
    if kind == "memory":
        return memory_vector_db(embedder)

    if kind == "pgvector":
        if not RAG_DB_URL:
            raise RuntimeError("RAG_DB_URL is required when RAG_VECTOR_DB=pgvector")
        try:
            from agno.vectordb.pgvector import PgVector
        except ImportError as error:
            raise RuntimeError(
                "Missing PgVector dependencies. Install sqlalchemy, psycopg, and pgvector."
            ) from error
        ACTIVE_VECTOR_DB_KIND = "pgvector"
        return PgVector(
            table_name=RAG_TABLE_NAME,
            schema=RAG_SCHEMA,
            db_url=RAG_DB_URL,
            embedder=embedder,
            search_type=SearchType.hybrid,
            vector_score_weight=0.75,
        )

    if not MONGO_URI:
        if RAG_MEMORY_FALLBACK:
            return memory_vector_db(embedder, "MONGODB_DIRECT_URI or MONGODB_URI is not configured")
        raise RuntimeError("MONGODB_DIRECT_URI or MONGODB_URI is required when RAG_VECTOR_DB uses MongoDB")

    if RAG_MEMORY_FALLBACK:
        try:
            verify_mongodb_connection(MONGO_URI, DB_NAME)
        except Exception as error:
            mark_mongo_unavailable()
            return memory_vector_db(embedder, str(error))

    if kind == "local-mongodb":
        ACTIVE_VECTOR_DB_KIND = "local-mongodb"
        return LocalMongoVectorDb(
            collection_name=RAG_TABLE_NAME,
            db_url=MONGO_URI,
            database=DB_NAME,
            embedder=embedder,
        )

    try:
        from agno.vectordb.mongodb import MongoDb
    except ImportError as error:
        raise RuntimeError("Missing MongoDB vector dependencies. Install pymongo.") from error
    ACTIVE_VECTOR_DB_KIND = "mongodb-atlas"
    return MongoDb(
        collection_name=RAG_TABLE_NAME,
        db_url=MONGO_URI,
        database=DB_NAME,
        embedder=embedder,
        search_type=SearchType.vector,
        search_index_name=RAG_MONGO_SEARCH_INDEX_NAME,
        wait_until_index_ready_in_seconds=float(os.getenv("RAG_MONGO_INDEX_WAIT_SECONDS", "3")),
        wait_after_insert_in_seconds=float(os.getenv("RAG_MONGO_INSERT_WAIT_SECONDS", "0")),
    )


def metadata_filter(user_id: str, thread_id: str, attachment_ids: Optional[list[str]] = None) -> dict[str, Any]:
    filters: dict[str, Any] = {"userId": user_id, "threadId": thread_id}
    ids = [str(value) for value in attachment_ids or [] if str(value)]
    if len(ids) == 1:
        filters["attachmentId"] = ids[0]
    return filters


def mongo_response_chunks(
    user_id: str,
    thread_id: str,
    limit: int,
    attachment_ids: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    if not mongo_available():
        return []
    ids = [str(value) for value in attachment_ids or [] if str(value)]
    try:
        from pymongo import MongoClient

        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        try:
            query: dict[str, Any] = {"userId": user_id, "threadId": thread_id}
            if ids:
                query["attachmentId"] = {"$in": ids}
            records = list(client[DB_NAME][RAG_RESPONSE_CHUNKS_NAME].find(query).sort([("attachmentOrder", 1), ("chunkIndex", 1)]).limit(limit))
        finally:
            client.close()
    except Exception:
        mark_mongo_unavailable()
        return []

    chunks: list[dict[str, Any]] = []
    for record in records:
        content = clean_source_text(str(record.get("chunkText") or record.get("text") or ""))
        if not is_readable_source_text(content):
            continue
        chunks.append(
            {
                "id": str(record.get("_id") or record.get("id") or ""),
                "userId": record.get("userId"),
                "threadId": record.get("threadId"),
                "attachmentId": record.get("attachmentId"),
                "fileName": record.get("fileName"),
                "fileType": record.get("fileType"),
                "fileSize": record.get("fileSize"),
                "chunkIndex": int(record.get("chunkIndex") or 0),
                "chunkText": content,
                "text": content,
                "embeddingModel": record.get("embeddingModel") or EMBEDDING_MODEL,
                "createdAt": record.get("createdAt"),
                "framework": "agno",
            }
        )
    return chunks


def save_response_chunks(chunks: list[dict[str, Any]]) -> None:
    if not chunks or not mongo_available():
        return
    try:
        from pymongo import MongoClient, ReplaceOne

        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        try:
            collection = client[DB_NAME][RAG_RESPONSE_CHUNKS_NAME]
            deletes = {
                (str(chunk.get("userId") or ""), str(chunk.get("threadId") or ""), str(chunk.get("attachmentId") or ""))
                for chunk in chunks
            }
            for user_id, thread_id, current_attachment_id in deletes:
                if user_id and thread_id and current_attachment_id:
                    collection.delete_many({"userId": user_id, "threadId": thread_id, "attachmentId": current_attachment_id})
            operations = []
            for order, chunk in enumerate(chunks):
                record = {
                    **chunk,
                    "attachmentOrder": order,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
                operations.append(
                    ReplaceOne(
                        {
                            "userId": record.get("userId"),
                            "threadId": record.get("threadId"),
                            "attachmentId": record.get("attachmentId"),
                            "chunkIndex": record.get("chunkIndex"),
                        },
                        record,
                        upsert=True,
                    )
                )
            if operations:
                collection.bulk_write(operations, ordered=False)
        finally:
            client.close()
    except Exception as error:
        mark_mongo_unavailable()
        print(f"{SERVICE_NAME} response chunk persistence failed: {error}", flush=True)


def public_document(document: Any, index: int = 0) -> dict[str, Any]:
    meta = dict(getattr(document, "meta_data", None) or {})
    content = clean_source_text(getattr(document, "content", "") or "")
    return {
        "id": str(getattr(document, "id", None) or meta.get("id") or ""),
        "userId": meta.get("userId"),
        "threadId": meta.get("threadId"),
        "attachmentId": meta.get("attachmentId"),
        "fileName": meta.get("fileName") or getattr(document, "name", None),
        "fileType": meta.get("fileType"),
        "fileSize": meta.get("fileSize"),
        "chunkIndex": int(meta.get("chunkIndex") or index),
        "chunkText": content,
        "text": content,
        "relevance": meta.get("similarity_score") or meta.get("score"),
        "vectorScore": meta.get("similarity_score") or meta.get("score"),
        "embeddingModel": meta.get("embeddingModel") or EMBEDDING_MODEL,
        "createdAt": meta.get("createdAt"),
        "framework": "agno",
    }


def readable_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for source in sources:
        content = clean_source_text(str(source.get("chunkText") or source.get("text") or ""))
        if not is_readable_source_text(content):
            continue
        cleaned.append({**source, "chunkText": content, "text": content})
    return cleaned


def source_metadata(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    metadata: list[dict[str, Any]] = []
    for source in sources:
        metadata.append(
            {
                "id": source.get("id"),
                "userId": source.get("userId"),
                "threadId": source.get("threadId"),
                "attachmentId": source.get("attachmentId"),
                "fileName": source.get("fileName"),
                "fileType": source.get("fileType"),
                "fileSize": source.get("fileSize"),
                "chunkIndex": source.get("chunkIndex"),
                "relevance": source.get("relevance"),
                "vectorScore": source.get("vectorScore"),
                "embeddingModel": source.get("embeddingModel"),
                "createdAt": source.get("createdAt"),
                "framework": source.get("framework") or "agno",
            }
        )
    return metadata


def chunk_text_for_response(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = 120) -> list[str]:
    clean = clean_source_text(text)
    if not clean:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + chunk_size)
        if end < len(clean):
            boundary = max(clean.rfind(". ", start, end), clean.rfind("\n", start, end))
            if boundary > start + int(chunk_size * 0.55):
                end = boundary + 1
        chunk = clean[start:end].strip()
        if chunk and is_readable_source_text(chunk):
            chunks.append(chunk)
        if end >= len(clean):
            break
        start = max(end - overlap, start + 1)
    return chunks


def fallback_rag_reply(message: str, sources: list[dict[str, Any]]) -> str:
    sources = readable_sources(sources)
    if not sources:
        return "I could not find relevant uploaded document content for that question."
    return "I found relevant uploaded document content, but the summary generation step is temporarily unavailable. Please try again."


def format_answer_prompt(message: str, sources: list[dict[str, Any]], summary_mode: bool, detail_mode: bool = False) -> str:
    sources = readable_sources(sources)
    if not sources:
        return message

    chunks: list[str] = []
    max_chunks = RAG_SUMMARY_TOP_K if summary_mode or detail_mode else RAG_TOP_K
    max_chars = RAG_SUMMARY_CHUNK_CHARS if summary_mode or detail_mode else 1400
    for index, source in enumerate(sources[:max_chunks], start=1):
        text = clean_source_text(str(source.get("chunkText") or source.get("text") or ""))
        if not text or not is_readable_source_text(text):
            continue
        file_name = str(source.get("fileName") or "uploaded document")
        chunk_index = int(source.get("chunkIndex") or 0) + 1
        chunks.append(f"[Source {index}] {file_name}, part {chunk_index}\n{text[:max_chars]}")

    if not chunks:
        return message

    source_chars = sum(len(normalize_text(str(source.get("chunkText") or source.get("text") or ""))) for source in sources)
    if source_chars < 2500:
        summary_length_instruction = "Keep the summary short: one brief overview paragraph and 3 to 5 bullets."
    elif source_chars < 9000:
        summary_length_instruction = "Use a medium-length summary: a short overview plus concise bullets for the main topics."
    else:
        summary_length_instruction = "Use a longer summary only because the document is long: cover all major topics with concise sections."

    system_prompt = (
        "You are a helpful AI assistant. Use the retrieved document context to generate a concise and meaningful answer. "
        "Do not return raw document text, source labels, OCR fragments, or full extracted chunks. "
        "Return only the final generated response for the user."
    )

    if summary_mode:
        task = (
            f"{system_prompt} "
            "The user is asking for a full-document summary. "
            "First infer the document structure from the source material: title, chapters, headings, subheadings, sections, tables, important concepts, and major topics covered. "
            "Build an internal map of those topics, then write a polished ChatGPT-style answer that synthesizes the complete uploaded document content below. "
            f"{summary_length_instruction} "
            "Cover every major heading/topic from the document at least briefly, section-by-section. Do not summarize only the most similar retrieved text. "
            "Preserve the document hierarchy and keep the flow coherent and connected. "
            "Use concise explanations instead of raw copied text. "
            "Use Markdown bold only for topic headings and section headings. Do not bold normal body sentences or bullet text. "
            "Keep body text plain, concise, and easy to scan. "
            "Include only details that are explicitly present in the source material. "
            "Never dump retrieved chunks, repeat OCR fragments, copy paragraphs directly, or return fragmented vector results. "
            "Do not mention chunks, retrieval, RAG, or source numbers in the answer. "
            "Do not add sections about missing information, limitations, recommendations, or comparisons unless the user asks for them. "
            "Do not end with statements like no additional information is available."
        )
    elif detail_mode:
        task = (
            f"{system_prompt} "
            "The user is asking for a detailed explanation. "
            "Do not simply retrieve chunks and repeat them. Infer the document hierarchy and explain the relevant content in simpler, clearer language. "
            "If the request refers broadly to 'it', 'this document', 'everything', or the previous document, explain all major sections in depth. "
            "If the request names a specific heading, topic, concept, or chapter, explain only that topic deeply and avoid summarizing the entire document. "
            "Cover definitions, concepts, workflows, steps, features, examples, benefits, limitations, tables, and important facts when they are present in the document. "
            "Add brief examples where useful and supported by the document. "
            "Use clear sections with bold Markdown headings. Do not bold normal body sentences or bullet text. "
            "Paraphrase instead of copying raw paragraphs. Never dump retrieved chunks, repeat OCR fragments, or return fragmented vector results. "
            "Stay grounded in the source material and do not invent details. Do not mention chunks, retrieval, RAG, or source numbers."
        )
    else:
        task = (
            f"{system_prompt} "
            "Answer the user's question in a polished ChatGPT-style response using the uploaded document source material below when it is relevant. "
            "If the user asks about a specific heading, topic, concept, or chapter, explain only that topic deeply and avoid summarizing the entire document. "
            "Synthesize related source material instead of copying raw paragraphs or dumping retrieved chunks. "
            "Match the user's requested depth and preserve useful document hierarchy. "
            "Do not mention chunks, retrieval, RAG, or source numbers."
        )

    instructions = [
        "System instructions:",
        task,
        "Retrieved document context for internal use only:",
        "\n\n".join(chunks),
        "Do not say there is no attached text or that you cannot access the document when source material is provided.",
    ]
    if not summary_mode and not detail_mode:
        instructions.append("If the chunks do not contain the requested answer, say what is missing.")
    instructions.extend(["User message:", message])
    return "\n\n".join(instructions)


def model_error_reply(reply: str) -> bool:
    return bool(
        re.search(
            r"\b(api[_ -]?key|environment variable|unauthorized|forbidden|rate[_ -]?limit|tokens per minute|request too large|quota|provider error|model unavailable|no attached text|no text attached|cannot access (the )?(uploaded )?document)\b",
            reply,
            re.I,
        )
    )


def clean_summary_markdown(reply: str) -> str:
    lines: list[str] = []
    for line in str(reply or "").splitlines():
        stripped = line.strip()
        heading_match = re.match(r"^\*\*(.+?)\*\*:?\s*$", stripped)
        if heading_match and not line.lstrip().startswith(("-", "*", "+")):
            lines.append(f"### **{heading_match.group(1).strip()}**")
            continue
        markdown_heading_match = re.match(r"^(#{1,6})\s+(.+?)\s*$", stripped)
        if markdown_heading_match:
            marker = markdown_heading_match.group(1)
            heading = re.sub(r"\*\*(.+?)\*\*", r"\1", markdown_heading_match.group(2)).strip()
            lines.append(f"{marker} **{heading}**")
            continue
        lines.append(re.sub(r"\*\*(.+?)\*\*", r"\1", line))
    return "\n".join(lines).strip()


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
                "You are an intelligent document analysis assistant.",
                "Do not simply retrieve chunks from the document and repeat them.",
                "Infer the document structure: title, chapters, headings, subheadings, sections, tables, important concepts, and major topics.",
                "Ground the answer in the retrieved content and do not invent document details.",
                "For question-answering, if the retrieved chunks do not contain the answer, say what is missing.",
                "When chunks are available, do not say you cannot access the uploaded document.",
                "Write polished ChatGPT-style answers with clear Markdown, concise paragraphs, and useful bullets.",
                "Match the user's requested depth. If they ask for a detailed explanation, provide a fuller structured explanation grounded in the document.",
                "Do not mention chunks, retrieval, RAG, source numbers, or internal context in the final answer.",
                "For summary requests, cover all major document headings and topics section-by-section, not only the top similarity matches.",
                "For topic-specific requests, explain only the requested topic and avoid summarizing the whole document.",
                "Never dump retrieved chunks, repeat OCR text, copy long paragraphs directly, or return fragmented vector results.",
                "For summary requests, synthesize a clear answer from the available document content only.",
                "For summary requests, do not include missing-information, limitation, recommendation, or critique sections unless explicitly requested.",
                "For summary requests, do not add filler endings such as no additional information is available.",
            ],
            knowledge=self.knowledge,
            search_knowledge=False,
            add_search_knowledge_instructions=False,
            add_knowledge_to_context=False,
            markdown=True,
            retries=1,
        )

    def stored_documents(
        self,
        user_id: str,
        thread_id: str,
        limit: int = 8,
        attachment_ids: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        ids = [str(value) for value in attachment_ids or [] if str(value)]
        response_chunks = mongo_response_chunks(user_id, thread_id, limit, ids)
        if response_chunks:
            return response_chunks

        vector_db = getattr(self.knowledge, "vector_db", None)
        records: list[dict[str, Any]] = []

        if isinstance(vector_db, MemoryVectorDb):
            for record in vector_db.records.values():
                meta = dict(record.get("meta_data") or {})
                if meta.get("userId") != user_id or meta.get("threadId") != thread_id:
                    continue
                if ids and str(meta.get("attachmentId") or "") not in ids:
                    continue
                records.append(record)
        elif MONGO_URI and vector_db_kind() in {"mongodb-atlas", "local-mongodb"}:
            try:
                from pymongo import MongoClient

                client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
                try:
                    query: dict[str, Any] = {"meta_data.userId": user_id, "meta_data.threadId": thread_id}
                    if ids:
                        query["meta_data.attachmentId"] = {"$in": ids}
                    records = list(client[DB_NAME][RAG_TABLE_NAME].find(query).sort("_id", 1).limit(max(limit * 3, limit)))
                finally:
                    client.close()
            except Exception:
                records = []

        chunks: list[dict[str, Any]] = []
        for index, record in enumerate(records[:limit]):
            meta = dict(record.get("meta_data") or {})
            content = clean_source_text(str(record.get("content") or ""))
            if not is_readable_source_text(content):
                continue
            chunks.append(
                {
                    "id": str(record.get("_id") or record.get("id") or ""),
                    "userId": meta.get("userId"),
                    "threadId": meta.get("threadId"),
                    "attachmentId": meta.get("attachmentId"),
                    "fileName": meta.get("fileName") or record.get("name"),
                    "fileType": meta.get("fileType"),
                    "fileSize": meta.get("fileSize"),
                    "chunkIndex": int(meta.get("chunkIndex") or index),
                    "chunkText": content,
                    "text": content,
                    "embeddingModel": meta.get("embeddingModel") or EMBEDDING_MODEL,
                    "createdAt": meta.get("createdAt"),
                    "framework": "agno",
                }
            )
        return chunks

    def has_documents(self, user_id: str, thread_id: str, attachment_ids: Optional[list[str]] = None) -> bool:
        return bool(self.stored_documents(user_id, thread_id, limit=1, attachment_ids=attachment_ids))

    def ingest(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        user_id = str(payload.get("userId") or "").strip()
        thread_id = str(payload.get("threadId") or "").strip()
        if not user_id or not thread_id:
            raise ValueError("Missing userId or threadId")

        message_id = str(payload.get("messageId") or "").strip()
        created_at = parse_datetime(payload.get("createdAt")).isoformat()
        stored: list[dict[str, Any]] = []

        for attachment in payload.get("attachments") or []:
            text = clean_source_text(str(attachment.get("text") or ""))
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
            for chunk_index, chunk_text in enumerate(chunk_text_for_response(text)):
                stored.append(
                    {
                        "id": f"{current_attachment_id}:{chunk_index}",
                        "userId": user_id,
                        "threadId": thread_id,
                        "attachmentId": current_attachment_id,
                        "fileName": file_name,
                        "fileType": metadata["fileType"],
                        "fileSize": metadata["fileSize"],
                        "chunkIndex": chunk_index,
                        "chunkText": chunk_text,
                        "text": chunk_text,
                        "embeddingModel": EMBEDDING_MODEL,
                        "createdAt": created_at,
                        "framework": "agno",
                    }
                )

        save_response_chunks(stored)
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
        chunks = readable_sources([public_document(document, index) for index, document in enumerate(documents)])
        if len(ids) > 1:
            id_set = set(ids)
            chunks = [chunk for chunk in chunks if str(chunk.get("attachmentId") or "") in id_set]
        if not chunks:
            chunks = self.stored_documents(
                user_id=user_id,
                thread_id=thread_id,
                limit=safe_limit,
                attachment_ids=ids,
            )
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
        detail_mode = bool(payload.get("detailMode"))
        requested_limit = int(payload.get("limit") or (RAG_SUMMARY_TOP_K if summary_mode or detail_mode else RAG_TOP_K))
        top_k = RAG_SUMMARY_TOP_K if summary_mode or detail_mode else RAG_TOP_K
        limit = min(max(requested_limit, 1), max(top_k, 1))
        query = str(payload.get("query") or message).strip()
        rag_chat_model = str(payload.get("ragModel") or payload.get("model") or DEFAULT_CHAT_MODEL)
        if (summary_mode or detail_mode) and stored_chunks:
            sources = stored_chunks[:limit]
        elif summary_mode or detail_mode:
            sources = self.stored_documents(
                user_id=user_id,
                thread_id=thread_id,
                limit=limit,
                attachment_ids=attachment_ids,
            )
        else:
            sources = self.search(
                user_id=user_id,
                thread_id=thread_id,
                query=query,
                limit=limit,
                summary_mode=summary_mode,
                attachment_ids=attachment_ids,
            )
            if not sources and stored_chunks:
                sources = stored_chunks[:limit]
            if not sources:
                sources = self.stored_documents(
                    user_id=user_id,
                    thread_id=thread_id,
                    limit=limit,
                    attachment_ids=attachment_ids,
                )
        if (summary_mode or detail_mode) and not sources:
            sources = self.search(
                user_id=user_id,
                thread_id=thread_id,
                query=query,
                limit=limit,
                summary_mode=summary_mode,
                attachment_ids=attachment_ids,
            )

        if not sources:
            return {
                "reply": fallback_rag_reply(message, []),
                "model": "rag-generation-unavailable",
                "usage": {},
                "sources": [],
                "storedChunks": len(stored_chunks),
                "error": None,
                "framework": "agno",
                "vectorDb": ACTIVE_VECTOR_DB_KIND or vector_db_kind(),
            }

        answer_prompt = format_answer_prompt(message, sources, summary_mode, detail_mode)
        run_errors: list[str] = []
        for candidate_model in rag_model_candidates(rag_chat_model):
            try:
                agent = self.build_answer_agent(model=candidate_model)
                output = agent.run(
                    answer_prompt,
                    user_id=user_id,
                    session_id=thread_id,
                    metadata={"framework": "agno", "threadId": thread_id},
                    knowledge_filters=metadata_filter(user_id, thread_id, attachment_ids),
                )
                reply = run_content(output)
                model = getattr(output, "model", None) or normalize_chat_model(candidate_model)
                usage = run_usage(output)
                error = None
                if sources and model_error_reply(reply):
                    raise RuntimeError(reply)
                break
            except Exception as run_error:
                run_errors.append(f"{normalize_chat_model(candidate_model)}: {run_error}")
                print(f"{SERVICE_NAME} Agno answer failed with {normalize_chat_model(candidate_model)}: {run_error}", flush=True)
        else:
            try:
                fallback_prompt = format_answer_prompt(message, sources, summary_mode, detail_mode)
                reply, model, usage = llm_service_generate(
                    fallback_prompt,
                    RAG_FALLBACK_CHAT_MODELS[0] if RAG_FALLBACK_CHAT_MODELS else rag_chat_model,
                    timeout_ms=min(max(AGNO_RUN_TIMEOUT, 15), 45) * 1000,
                )
                error = None
            except Exception as fallback_error:
                reply = fallback_rag_reply(message, sources)
                model = "rag-generation-unavailable"
                usage = {}
                error = {
                    "code": "AGNO_MODEL_UNAVAILABLE",
                    "message": "; ".join(run_errors + [f"fallback failed: {fallback_error}"]),
                }
                print(f"{SERVICE_NAME} LLM fallback failed: {fallback_error}", flush=True)

        if not reply:
            reply = fallback_rag_reply(message, sources)
            model = "rag-generation-unavailable"
            usage = {}
            error = {"code": "AGNO_EMPTY_RESPONSE", "message": "Agno did not return a response"}
        elif summary_mode or detail_mode:
            reply = clean_summary_markdown(reply)

        reply = clean_answer_text(reply)

        return {
            "reply": reply,
            "model": model,
            "usage": usage,
            "sources": source_metadata(sources),
            "storedChunks": len(stored_chunks),
            "error": error,
            "framework": "agno",
            "vectorDb": ACTIVE_VECTOR_DB_KIND or vector_db_kind(),
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
            configured_vector_db = vector_db_kind()
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": SERVICE_NAME,
                    "framework": "agno",
                    "ragMode": "knowledge",
                    "vectorDb": ACTIVE_VECTOR_DB_KIND or configured_vector_db,
                    "configuredVectorDb": configured_vector_db,
                    "memoryFallbackEnabled": RAG_MEMORY_FALLBACK,
                    "tableName": RAG_TABLE_NAME,
                    "searchIndexName": RAG_MONGO_SEARCH_INDEX_NAME if configured_vector_db == "mongodb-atlas" else None,
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
            if self.path == "/status":
                has_documents = rag_engine.has_documents(
                    user_id=str(payload.get("userId") or "").strip(),
                    thread_id=str(payload.get("threadId") or "").strip(),
                    attachment_ids=payload.get("attachmentIds") or [],
                )
                send_json(self, 200, {"hasDocuments": has_documents, "framework": "agno"})
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
