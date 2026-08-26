from typing import Dict, Any, Optional

from fastapi import APIRouter, Query, Body, Depends

from core.auth import get_current_user
from services.history_service import (
    create_history_entry,
    list_schema_history,
    list_user_all_history,
    get_user_distinct_schemas,
    get_history_entry,
    delete_history_entry,
)

router = APIRouter(prefix="/history", tags=["history"])


@router.post("/log")
def api_log_history(
    payload: Dict = Body(
        ...,
        example={
            "schema_id": "My_Ontology_abc123",
            "schema_name": "My Ontology",
            "action": "updated",
            "changes": {
                "nodes_added": [],
                "nodes_removed": [],
                "nodes_modified": [],
                "edges_added": [],
                "edges_removed": [],
                "edges_modified": [],
                "summary": "Added 2 nodes",
            },
        },
    ),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Log a schema change history entry.
    Called by the frontend after a successful canvas save.
    """
    schema_id = payload.get("schema_id")
    schema_name = payload.get("schema_name", "")
    action = payload.get("action", "updated")
    changes = payload.get("changes", {})

    if not schema_id:
        from fastapi import HTTPException
        raise HTTPException(422, detail="schema_id is required")

    entry = create_history_entry(
        user_email=current_user["email"],
        schema_id=schema_id,
        schema_name=schema_name,
        action=action,
        changes=changes,
    )

    return {"status": "ok", "entry": entry}


@router.get("/user/all")
def api_get_all_user_history(
    limit: int = Query(10, ge=1, le=100),
    skip: int = Query(0, ge=0),
    schema_id: Optional[str] = Query(None),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Return paginated schema change history entries for the current user."""
    return list_user_all_history(
        user_email=current_user["email"],
        limit=limit,
        skip=skip,
        schema_id=schema_id,
    )


@router.get("/user/schemas")
def api_get_user_history_schemas(
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Return distinct schemas for the user for the history filter dropdown."""
    schemas = get_user_distinct_schemas(user_email=current_user["email"])
    return {"schemas": schemas}


@router.get("/{schema_id}")
def api_get_schema_history(
    schema_id: str,
    limit: int = Query(10, ge=1, le=100),
    skip: int = Query(0, ge=0),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Return paginated history entries for a schema, newest first."""
    return list_schema_history(
        user_email=current_user["email"],
        schema_id=schema_id,
        limit=limit,
        skip=skip,
    )



@router.get("/entry/{entry_id}")
def api_get_history_entry(
    entry_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Return a single history entry by ID."""
    entry = get_history_entry(
        user_email=current_user["email"],
        entry_id=entry_id,
    )
    if not entry:
        from fastapi import HTTPException
        raise HTTPException(404, detail="History entry not found")
    return entry


@router.delete("/entry/{entry_id}")
def api_delete_history_entry(
    entry_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Delete a single history entry."""
    success = delete_history_entry(
        user_email=current_user["email"],
        entry_id=entry_id,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(404, detail="History entry not found or already deleted")
    return {"status": "ok", "message": "History entry deleted"}

