from datetime import datetime
from typing import List, Dict, Optional
from uuid import uuid4
from bson import ObjectId

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
    """
    # Compute next version number for this schema
    latest = schema_history_collection.find_one(
        {"user_email": user_email, "schema_id": schema_id},
        sort=[("version", -1)],
        projection={"version": 1},
    )
    version = (latest["version"] + 1) if latest and "version" in latest else 1

    entry_id = str(uuid4())
    doc = {
        "entry_id": entry_id,
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
        {"user_email": user_email, "schema_id": schema_id}
    ).sort("saved_at", -1).limit(limit)

    results = []
    for doc in cursor:
        if "entry_id" not in doc:
            doc["entry_id"] = str(doc["_id"])
        doc.pop("_id", None)
        if "saved_at" in doc and isinstance(doc["saved_at"], datetime):
            doc["saved_at"] = doc["saved_at"].isoformat()
        results.append(doc)

    return results


def list_user_all_history(
    user_email: str,
    limit: int = 100,
) -> List[Dict]:
    """Return all recent history entries for a user across all schemas, newest first."""
    cursor = schema_history_collection.find(
        {"user_email": user_email}
    ).sort("saved_at", -1).limit(limit)

    results = []
    for doc in cursor:
        if "entry_id" not in doc:
            doc["entry_id"] = str(doc["_id"])
        doc.pop("_id", None)
        if "saved_at" in doc and isinstance(doc["saved_at"], datetime):
            doc["saved_at"] = doc["saved_at"].isoformat()
        results.append(doc)

    return results


def get_history_entry(user_email: str, entry_id: str) -> Optional[Dict]:
    """Return a single history entry by its entry_id or _id."""
    query = {
        "user_email": user_email,
        "$or": [{"entry_id": entry_id}],
    }
    if ObjectId.is_valid(entry_id):
        query["$or"].append({"_id": ObjectId(entry_id)})

    doc = schema_history_collection.find_one(query)
    if doc:
        if "entry_id" not in doc:
            doc["entry_id"] = str(doc["_id"])
        doc.pop("_id", None)
        if "saved_at" in doc and isinstance(doc["saved_at"], datetime):
            doc["saved_at"] = doc["saved_at"].isoformat()
    return doc


def delete_history_entry(user_email: str, entry_id: str) -> bool:
    """Delete a single history entry by entry_id or _id."""
    query = {
        "user_email": user_email,
        "$or": [{"entry_id": entry_id}],
    }
    if ObjectId.is_valid(entry_id):
        query["$or"].append({"_id": ObjectId(entry_id)})

    res = schema_history_collection.delete_one(query)
    return res.deleted_count > 0


