from typing import Dict, Optional, List
from fastapi import HTTPException, UploadFile
from core.config import settings

from services.instance_generation_service import build_instances_from_csvs

from services.graphdb_service import (
    # base ontology (read-only)
    full_schema_graph,
    resolve_schema_term_to_iri,
    neighbors_schema,
    neighbors_both,
    neighbors_schema_and_instances,
    get_instance_summary,

    # NEW: workspace group details (virtual node click)
    workspace_group_values,

    # multi-schema workspace helpers
    init_user_schema_graph_from_base,
    user_schema_graph,
    export_graph_turtle,
    user_schema_instance_graph,
    import_turtle_to_named_graph,

    # graph-scoped reads
    neighbors_schema_in_graph,
    neighbors_both_in_graph,
    neighbors_schema_and_instances_in_two_graphs,

    # graph-scoped writes
    add_schema_triple_in_graph,
    delete_schema_triple_in_graph,
    update_schema_triple_in_graph,
)

#  BASE ONTOLOGY (READ) -

def ctrl_full_schema_graph(limit: int) -> Dict:
    """Return the whole base schema graph (no instances)."""
    return full_schema_graph(limit=limit)


def _resolve_node_iri_or_404(q: str) -> str:
    """Resolve a term or IRI string to a schema IRI, or raise 404."""
    node_iri = q if (q or "").startswith("http") else resolve_schema_term_to_iri(q)
    if not node_iri:
        raise HTTPException(404, detail=f"Could not resolve '{q}' to a schema IRI")
    return node_iri


def ctrl_neighbors_schema(q: str, limit: int) -> Dict:
    """Neighbors around a node (schema-only) from the BASE ontology."""
    node_iri = _resolve_node_iri_or_404(q)
    if node_iri.startswith(settings.CMP_INSTANCE_NS):
        raise HTTPException(400, detail="Resolved to an instance IRI; use a schema IRI/term")
    return neighbors_schema(node_iri, limit=limit)


def ctrl_neighbors_schema_and_instances(q: str, limit: int):
    """
    Neighbors from BASE schema graph + BASE instance graph
    """
    node_iri = q if q.startswith("http") else resolve_schema_term_to_iri(q)

    if not node_iri:
        raise HTTPException(
            status_code=404,
            detail=f"Could not resolve '{q}' to a schema IRI",
        )

    return neighbors_schema_and_instances(node_iri, limit)


def ctrl_instance_details(instance_iri: str) -> Dict:
    """
    BASE INSTANCE ONLY (unchanged).
    """
    if not instance_iri.startswith(settings.CMP_INSTANCE_NS):
        raise HTTPException(400, "Not an instance IRI")

    return get_instance_summary(instance_iri)


def ctrl_neighbors_both(q: str, limit: int) -> Dict:
    """Neighbors around a node (schema + instances) from the BASE ontology."""
    node_iri = _resolve_node_iri_or_404(q)
    return neighbors_both(node_iri, limit=limit)


# USER WORKSPACE (MULTI-SCHEMA) # Each user can have multiple schema graphs:
#   graph = user_schema_graph(user_key, schema_id)

def ctrl_init_workspace(user_key: str, schema_id: str) -> Dict:
    """
    Ensure that the user has a specific workspace schema initialized by COPYING
    the base schema into a per-user-per-schema named graph (if not already done).
    """
    if not schema_id:
        raise HTTPException(422, detail="schema_id is required")
    return init_user_schema_graph_from_base(user_key, schema_id)


def ctrl_export_workspace(user_key: str, schema_id: str) -> str:
    """
    Export the user's selected workspace schema graph as Turtle.
    """
    if not schema_id:
        raise HTTPException(422, detail="schema_id is required")
    graph_iri = user_schema_graph(user_key, schema_id)
    return export_graph_turtle(graph_iri)


def _is_workspace_group_node(iri: str) -> bool:
    """
    Virtual node created by backend for aggregated workspace instances.
    """
    base = settings.CMP_NS.rstrip("/") + "/instance/group/"
    return (iri or "").startswith(base)


def ctrl_workspace_neighbors(
    user_key: str,
    schema_id: str,
    q: str,
    limit: int,
    level: str = "schema",
) -> Dict:
    """
    Neighbors around a node inside a user's workspace.

    level:
      - "schema" : only user's workspace schema graph
      - "both"   : user's workspace schema graph + user's workspace instance graph

    IMPORTANT:
    - For workspace level="both", the graphdb_service now returns "workspace_group" virtual nodes
      for class searches (e.g., Velocity), so we handle clicks on those virtual nodes here.
    """
    if not schema_id:
        raise HTTPException(422, detail="schema_id is required")

    schema_graph_iri = user_schema_graph(user_key, schema_id)

    # schema-only (unchanged)
    if level != "both":
        node_iri = _resolve_node_iri_or_404(q)
        return neighbors_schema_in_graph(node_iri, schema_graph_iri, limit=limit)

    # schema + workspace instances
    instance_graph_iri = user_schema_instance_graph(user_key, schema_id)

    # 1) If user clicked an aggregated workspace group node, return its values/details.
    if _is_workspace_group_node(q):
        details = workspace_group_values(
            group_node_iri=q,
            instance_graph_iri=instance_graph_iri,
            limit=5000,
        )

        # Minimal graph response (safe for existing frontend):
        return {
            "node": q,
            "nodes": [
                {
                    "iri": q,
                    "label": None,
                    "kind": "workspace_group",
                    "groupKey": details.get("groupKey"),
                    "summary": details.get("summary"),
                    "values": details.get("values"),
                }
            ],
            "edges": [],
            "details": details,  # optional; frontend can use this directly
        }

    # 2) Otherwise resolve q as schema term/IRI and return schema+instance neighborhood.
    node_iri = _resolve_node_iri_or_404(q)

    return neighbors_schema_and_instances_in_two_graphs(
        node_iri=node_iri,
        schema_graph_iri=schema_graph_iri,
        instance_graph_iri=instance_graph_iri,
        limit=limit,
    )


# helpers 
def _validate_payload_fields(payload: Dict, required: Dict[str, str]) -> None:
    """
    Helper to ensure required keys exist in a JSON body.
    'required' is a mapping {field_name: human_label}.
    """
    for key, label in required.items():
        if key not in payload or payload[key] in (None, ""):
            raise HTTPException(422, detail=f"Missing or empty field: {label} ('{key}')")


def _graph_for(user_key: str, schema_id: str) -> str:
    if not schema_id:
        raise HTTPException(422, detail="schema_id is required")
    return user_schema_graph(user_key, schema_id)


# workspace writes 
def ctrl_workspace_add_relation(user_key: str, schema_id: str, payload: Dict) -> Dict:
    """
    Add a schema triple in the user's selected workspace schema graph.

    Expected payload:
      {
        "subject":   "...schema IRI...",
        "predicate": "...predicate IRI...",
        "object":    "...schema IRI..."
      }
    """
    _validate_payload_fields(payload, {"subject": "subject", "predicate": "predicate", "object": "object"})

    subject = payload["subject"]
    predicate = payload["predicate"]
    obj = payload["object"]
    graph_iri = _graph_for(user_key, schema_id)

    try:
        add_schema_triple_in_graph(subject, predicate, obj, graph_iri)
        neighbors = neighbors_schema_in_graph(subject, graph_iri, limit=2000)
        return {"status": "ok", "neighbors": neighbors}
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


def ctrl_workspace_delete_relation(user_key: str, schema_id: str, payload: Dict) -> Dict:
    """
    Delete schema triple(s) in the user's selected workspace schema graph.

    Expected payload:
      {
        "subject":   "...schema IRI...",
        "predicate": "...predicate IRI...",
        # optional "object": "...schema IRI..."  -> delete only that object
      }
    """
    _validate_payload_fields(payload, {"subject": "subject", "predicate": "predicate"})

    subject = payload["subject"]
    predicate = payload["predicate"]
    obj: Optional[str] = payload.get("object")
    graph_iri = _graph_for(user_key, schema_id)

    try:
        delete_schema_triple_in_graph(subject, predicate, obj, graph_iri)
        neighbors = neighbors_schema_in_graph(subject, graph_iri, limit=2000)
        return {"status": "ok", "neighbors": neighbors}
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


def ctrl_workspace_update_relation(user_key: str, schema_id: str, payload: Dict) -> Dict:
    """
    Update a schema triple in the user's selected workspace schema graph.

    Expected payload:
      {
        "subject":     "...schema IRI...",
        "predicate":   "...predicate IRI...",
        "new_object":  "...schema IRI...",
        # optional "old_object": "...schema IRI..."
      }
    """
    _validate_payload_fields(payload, {"subject": "subject", "predicate": "predicate", "new_object": "new_object"})

    subject = payload["subject"]
    predicate = payload["predicate"]
    new_obj = payload["new_object"]
    old_obj: Optional[str] = payload.get("old_object")
    graph_iri = _graph_for(user_key, schema_id)

    try:
        update_schema_triple_in_graph(subject, predicate, old_obj, new_obj, graph_iri)
        neighbors = neighbors_schema_in_graph(subject, graph_iri, limit=2000)
        return {"status": "ok", "neighbors": neighbors}
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


def ctrl_workspace_upload_instances(
    user_key: str,
    schema_id: str,
    files: List[UploadFile],
) -> dict:
    if not files:
        raise HTTPException(422, detail="No CSV files provided")

    raw_files: List[bytes] = []
    names: List[str] = []

    for f in files:
        content = f.file.read()
        raw_files.append(content)
        names.append(f.filename or "data.csv")

    result = build_instances_from_csvs(
        files=raw_files,
        filenames=names,
        user_key=user_key,
        schema_id=schema_id,
    )

    instance_graph = user_schema_instance_graph(user_key, schema_id)

    # Upload TTL into user's instance graph
    import_turtle_to_named_graph(result.turtle, instance_graph)

    return {
        "status": "ok",
        "message": "Instances generated and uploaded",
        "schema_id": schema_id,
        "instance_graph": instance_graph,
        "triples": result.triples,
        "turtle": result.turtle,
    }
