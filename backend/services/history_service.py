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
    skip: int = 0,
) -> Dict:
    """Return recent history entries for a schema, newest first."""
    query = {"user_email": user_email, "schema_id": schema_id}
    total = schema_history_collection.count_documents(query)
    cursor = (
        schema_history_collection.find(query)
        .sort("saved_at", -1)
        .skip(skip)
        .limit(limit)
    )

    results = []
    for doc in cursor:
        if "entry_id" not in doc:
            doc["entry_id"] = str(doc["_id"])
        doc.pop("_id", None)
        if "saved_at" in doc and isinstance(doc["saved_at"], datetime):
            doc["saved_at"] = doc["saved_at"].isoformat()
        results.append(doc)

    return {
        "entries": results,
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": (skip + len(results)) < total,
    }


def list_user_all_history(
    user_email: str,
    limit: int = 10,
    skip: int = 0,
    schema_id: Optional[str] = None,
) -> Dict:
    """Return paginated history entries for a user across all or specific schema, newest first."""
    query = {"user_email": user_email}
    if schema_id and schema_id != "all":
        query["schema_id"] = schema_id

    total = schema_history_collection.count_documents(query)
    cursor = (
        schema_history_collection.find(query)
        .sort("saved_at", -1)
        .skip(skip)
        .limit(limit)
    )

    results = []
    for doc in cursor:
        if "entry_id" not in doc:
            doc["entry_id"] = str(doc["_id"])
        doc.pop("_id", None)
        if "saved_at" in doc and isinstance(doc["saved_at"], datetime):
            doc["saved_at"] = doc["saved_at"].isoformat()
        results.append(doc)

    return {
        "entries": results,
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": (skip + len(results)) < total,
    }


def get_user_distinct_schemas(user_email: str) -> List[Dict]:
    """Return distinct schemas that have history entries for this user."""
    pipeline = [
        {"$match": {"user_email": user_email}},
        {"$group": {"_id": "$schema_id", "schema_name": {"$first": "$schema_name"}}},
        {"$sort": {"schema_name": 1}},
    ]
    docs = list(schema_history_collection.aggregate(pipeline))
    return [
        {"id": d["_id"], "name": d.get("schema_name") or d["_id"]}
        for d in docs
        if d["_id"]
    ]


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



