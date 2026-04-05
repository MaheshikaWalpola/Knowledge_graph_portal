from datetime import datetime
from typing import List, Dict, Optional
from uuid import uuid4

from services.mongo_service import user_schemas_collection


def create_schema_meta(
    user_email: str,
    name: str,
    graph_iri: str,
    upload_mode: str = "base",
    namespace: Optional[str] = None,
    instance_graph_iri: Optional[str] = None,
    schema_id: Optional[str] = None,
) -> Dict:
    """
    Create metadata record for a user schema.

    upload_mode:
      - "base"     — copied from base schema
      - "combined" — user uploaded a single RDF file
      - "separate" — user uploaded schema + instance files
    """
    if not schema_id:
        schema_id = str(uuid4())
        
    doc = {
        "user_email": user_email,
        "schema_id": schema_id,
        "name": name,
        "graph_iri": graph_iri,
        "upload_mode": upload_mode,
        "namespace": namespace,
        "instance_graph_iri": instance_graph_iri,
        "created_at": datetime.utcnow(),
    }
    user_schemas_collection.insert_one(doc)
    doc.pop("_id", None)  # Remove ObjectId to prevent Pydantic serialization errors
    return doc


def list_user_schemas(user_email: str) -> List[Dict]:
    return list(
        user_schemas_collection.find(
            {"user_email": user_email},
            {"_id": 0},
        ).sort("created_at", -1)
    )


def get_user_schema(user_email: str, schema_id: str) -> Optional[Dict]:
    return user_schemas_collection.find_one(
        {"user_email": user_email, "schema_id": schema_id},
        {"_id": 0},
    )


def delete_user_schema(user_email: str, schema_id: str) -> bool:
    """Delete a schema metadata doc. Returns True if deleted."""
    result = user_schemas_collection.delete_one(
        {"user_email": user_email, "schema_id": schema_id}
    )
    return result.deleted_count > 0
