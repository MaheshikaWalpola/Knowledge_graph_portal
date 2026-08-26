from datetime import datetime
from typing import List, Dict, Optional
from uuid import uuid4

from services.mongo_service import schema_history_collection


def create_history_entry(
    user_email: str,
    schema_id: str,
    schema_name: str,
    action: str,
    changes: Dict,
) -> Dict:
    """
    Create a history log entry for a canvas schema save.

    action: "created" | "updated" | "imported"
    changes: {
        nodes_added: [...],
        nodes_removed: [...],
        nodes_modified: [...],
        edges_added: [...],
        edges_removed: [...],
        edges_modified: [...],
        summary: "Added 2 nodes, removed 1 edge"
    }
    """
    # Compute next version number for this schema
    latest = schema_history_collection.find_one(
        {"user_email": user_email, "schema_id": schema_id},
        sort=[("version", -1)],
        projection={"version": 1},
    )
    version = (latest["version"] + 1) if latest and "version" in latest else 1

    doc = {
        "entry_id": str(uuid4()),
        "user_email": user_email,
        "schema_id": schema_id,
        "schema_name": schema_name,
        "action": action,
        "changes": changes,
        "version": version,
        "saved_at": datetime.utcnow().isoformat(),
    }

    schema_history_collection.insert_one(doc)
    doc.pop("_id", None)
    return doc


def list_schema_history(
    user_email: str,
    schema_id: str,
    limit: int = 50,
) -> List[Dict]:
    """Return recent history entries for a schema, newest first."""
    cursor = schema_history_collection.find(
        {"user_email": user_email, "schema_id": schema_id},
        {"_id": 0},
    ).sort("saved_at", -1).limit(limit)

    return list(cursor)


def list_user_all_history(
    user_email: str,
    limit: int = 100,
) -> List[Dict]:
    """Return all recent history entries for a user across all schemas, newest first."""
    cursor = schema_history_collection.find(
        {"user_email": user_email},
        {"_id": 0},
    ).sort("saved_at", -1).limit(limit)

    return list(cursor)


def get_history_entry(user_email: str, entry_id: str) -> Optional[Dict]:
    """Return a single history entry by its entry_id."""
    return schema_history_collection.find_one(
        {"user_email": user_email, "entry_id": entry_id},
        {"_id": 0},
    )


def delete_history_entry(user_email: str, entry_id: str) -> bool:
    """Delete a single history entry by ID."""
    res = schema_history_collection.delete_one(
        {"user_email": user_email, "entry_id": entry_id}
    )
    return res.deleted_count > 0

