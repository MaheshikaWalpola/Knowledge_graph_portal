from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.auth_service import get_current_user_email
from services.chat_service import (
    delete_conversation,
    get_conversations,
    upsert_conversation,
)

router = APIRouter(prefix="/chats", tags=["chats"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class MessageSchema(BaseModel):
    role: str
    content: str


class ConversationUpsertBody(BaseModel):
    title: str
    messages: List[MessageSchema]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def api_get_conversations(
    email: str = Depends(get_current_user_email),
):
    """Return all saved conversations for the logged-in user."""
    convos = get_conversations(email)
    # Convert datetime objects to ISO strings for JSON serialisation
    for c in convos:
        if hasattr(c.get("updated_at"), "isoformat"):
            c["updated_at"] = c["updated_at"].isoformat()
    return {"conversations": convos}


@router.put("/{chat_id}")
def api_upsert_conversation(
    chat_id: float,
    body: ConversationUpsertBody,
    email: str = Depends(get_current_user_email),
):
    """Create or update a conversation (upsert by chat_id)."""
    messages = [m.model_dump() for m in body.messages]
    doc = upsert_conversation(
        email=email,
        chat_id=chat_id,
        title=body.title,
        messages=messages,
    )
    if hasattr(doc.get("updated_at"), "isoformat"):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return {"ok": True, "conversation": doc}


@router.delete("/{chat_id}")
def api_delete_conversation(
    chat_id: float,
    email: str = Depends(get_current_user_email),
):
    """Delete one conversation for the logged-in user."""
    deleted = delete_conversation(email=email, chat_id=chat_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True, "deleted": deleted}
