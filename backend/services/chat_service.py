from datetime import datetime, timezone
from typing import List, Optional

from services.mongo_service import chat_conversations_collection


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(doc: dict) -> dict:
    """Strip MongoDB _id and normalise for JSON serialisation."""
    doc.pop("_id", None)
    return doc


# --- Read ---

def get_conversations(email: str) -> List[dict]:
    """Return all saved conversations for a user, newest first."""
    docs = chat_conversations_collection.find(
        {"user_email": email},
        sort=[("updated_at", -1)],
    )
    return [_serialize(d) for d in docs]


# --- Write ---

def upsert_conversation(email: str, chat_id: float, title: str, messages: list) -> dict:
    """Create or fully replace a conversation document."""
    doc = {
        "user_email": email,
        "chat_id":    chat_id,
        "title":      title,
        "messages":   messages,
        "updated_at": _now(),
    }
    chat_conversations_collection.update_one(
        {"user_email": email, "chat_id": chat_id},
        {"$set": doc},
        upsert=True,
    )
    return doc


# --- Delete ---

def delete_conversation(email: str, chat_id: float) -> int:
    """Delete one conversation. Returns number of documents deleted."""
    result = chat_conversations_collection.delete_one(
        {"user_email": email, "chat_id": chat_id}
    )
    return result.deleted_count
