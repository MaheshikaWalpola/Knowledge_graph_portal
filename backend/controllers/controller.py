from typing import Dict, Optional, List
from fastapi import HTTPException, UploadFile
from core.config import settings

from services.instance_generation_service import build_instances_from_csvs
from services.rdf_upload_service import parse_rdf_bytes, split_schema_and_instances
from services.user_schema_service import (
    create_schema_meta,
    list_user_schemas,
    get_user_schema,
    delete_user_schema,
)

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

    # uploaded schema support (namespace-agnostic)
    full_uploaded_schema_graph,
    neighbors_in_uploaded_graph,
    neighbors_in_uploaded_two_graphs,
    search_terms_in_graph,
    resolve_term_in_graph,
    delete_named_graph,
    add_triple_in_graph_no_ns_check,
    delete_triple_in_graph_no_ns_check,
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

    # Check if it's an uploaded schema (stored in MongoDB)
    meta = get_user_schema(user_key, schema_id)
    if meta and meta.get("graph_iri"):
        return export_graph_turtle(meta["graph_iri"])

    # Fallback to base-derived workspace graph
    graph_iri = user_schema_graph(user_key, schema_id)
    return export_graph_turtle(graph_iri)


def _is_workspace_group_node(iri: str) -> bool:
    """
    Virtual node created by backend for aggregated workspace instances.
    """
    base = settings.CMP_NS.rstrip("/") + "/instance/group/"
    return (iri or "").startswith(base)


def _is_uploaded_schema(meta: Optional[Dict]) -> bool:
    """Check if a schema metadata doc represents an uploaded schema."""
    return meta is not None and meta.get("upload_mode") in ("combined", "separate")


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

    Supports both base-derived workspaces and uploaded schemas.
    """
    if not schema_id:
        raise HTTPException(422, detail="schema_id is required")

    # Check if this is an uploaded schema
    meta = get_user_schema(user_key, schema_id)

    if _is_uploaded_schema(meta):
        return _uploaded_workspace_neighbors(meta, q, limit, level)

    # ─── ORIGINAL BASE-DERIVED WORKSPACE FLOW (unchanged) ───
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


def _uploaded_workspace_neighbors(
    meta: Dict, q: str, limit: int, level: str
) -> Dict:
    """
    Handle neighbor queries for uploaded schemas using namespace-agnostic queries.
    """
    graph_iri = meta["graph_iri"]
    instance_graph_iri = meta.get("instance_graph_iri")

    # Resolve q: if it's a full IRI use it directly, otherwise search in the graph
    if (q or "").startswith("http"):
        node_iri = q
    else:
        node_iri = resolve_term_in_graph(q, graph_iri)
        if not node_iri:
            raise HTTPException(404, detail=f"Could not resolve '{q}' in the uploaded schema")

    if level == "both" and instance_graph_iri:
        return neighbors_in_uploaded_two_graphs(
            node_iri=node_iri,
            schema_graph_iri=graph_iri,
            instance_graph_iri=instance_graph_iri,
            limit=limit,
        )

    return neighbors_in_uploaded_graph(node_iri, graph_iri, limit=limit)


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

    return {"status": "ok", "message": "Instances generated and uploaded", "schema_id": schema_id, "instance_graph": instance_graph, "triples": result.triples, "turtle": result.turtle}


def ctrl_list_user_schemas(user_email: str) -> Dict:
    """Return all schemas initialized/uploaded by the user."""
    schemas = list_user_schemas(user_email)
    return {"status": "ok", "schemas": schemas}


def ctrl_delete_user_schema(user_email: str, schema_id: str) -> Dict:
    """Delete a user schema and drop its GraphDB instances."""
    meta = get_user_schema(user_email, schema_id)
    if not meta:
        raise HTTPException(404, detail="Schema not found")

    # Drop graphs
    if meta.get("graph_iri"):
        try:
            delete_named_graph(meta["graph_iri"])
        except Exception as e:
            print(f"Warning: could not drop graph {meta['graph_iri']}: {e}")

    if meta.get("instance_graph_iri"):
        try:
            delete_named_graph(meta["instance_graph_iri"])
        except Exception as e:
            print(f"Warning: could not drop graph {meta['instance_graph_iri']}: {e}")

    # Remove from MongoDB (fallback to generic instance graph if not uploaded)
    if not meta.get("upload_mode") or meta.get("upload_mode") == "base":
        inst_graph = user_schema_instance_graph(user_email, schema_id)
        try:
            delete_named_graph(inst_graph)
        except Exception as e:
            print(f"Warning: could not drop graph {inst_graph}: {e}")

    delete_user_schema(user_email, schema_id)
    return {"status": "ok", "message": "Schema deleted successfully"}


def ctrl_upload_schema(
    user_email: str,
    name: str,
    mode: str,
    schema_file: UploadFile,
    instances_file: Optional[UploadFile],
) -> Dict:
    """
    Handle uploading custom ontologies.
    mode = "combined" | "separate"
    """
    if mode not in ["combined", "separate"]:
        raise HTTPException(422, detail="Invalid upload mode (combined|separate)")

    if not name.strip():
        raise HTTPException(422, detail="Schema name is required")

    # Prevent duplicate ontology names per user
    existing = list_user_schemas(user_email)
    for s in existing:
        if s.get("name", "").strip().lower() == name.strip().lower():
            raise HTTPException(
                409,
                detail=f"An ontology named '{name.strip()}' already exists. Please choose a different name.",
            )

    # Generate graph IRIs
    schema_id = "upload_" + name.replace(" ", "_")[:20] + "_" + str(hash(user_email))[:6]
    graph_iri = user_schema_graph(user_email, schema_id)
    instance_graph_iri = user_schema_instance_graph(user_email, schema_id)

    schema_content = schema_file.file.read()

    try:
        parsed_schema = parse_rdf_bytes(schema_content, schema_file.filename)
    except Exception as e:
        raise HTTPException(400, detail=f"Failed to parse schema file: {e}")

    namespace = parsed_schema.namespace

    if mode == "combined":
        # Import everything into the schema graph
        try:
            import_turtle_to_named_graph(parsed_schema.turtle, graph_iri)
        except Exception as e:
            raise HTTPException(500, detail=f"Failed to import graph: {e}")

        # Save metadata
        meta = create_schema_meta(
            user_email=user_email,
            name=name,
            graph_iri=graph_iri,
            upload_mode="combined",
            namespace=namespace,
            instance_graph_iri=None,
            schema_id=schema_id,
        )

        return {
            "status": "ok",
            "message": "Combined schema uploaded successfully",
            "schema": meta
        }

    else:
        # separate mode
        if not instances_file:
            raise HTTPException(422, detail="instances_file is required for separate mode")

        # Import schema file to schema graph
        try:
            import_turtle_to_named_graph(parsed_schema.turtle, graph_iri)
        except Exception as e:
            raise HTTPException(500, detail=f"Failed to import schema graph: {e}")

        inst_content = instances_file.file.read()
        try:
            parsed_inst = parse_rdf_bytes(inst_content, instances_file.filename)
        except Exception as e:
            # Rollback
            delete_named_graph(graph_iri)
            raise HTTPException(400, detail=f"Failed to parse instances file: {e}")

        try:
            import_turtle_to_named_graph(parsed_inst.turtle, instance_graph_iri)
        except Exception as e:
            # Rollback
            delete_named_graph(graph_iri)
            raise HTTPException(500, detail=f"Failed to import instance graph: {e}")

        # Save metadata
        meta = create_schema_meta(
            user_email=user_email,
            name=name,
            graph_iri=graph_iri,
            upload_mode="separate",
            namespace=namespace,
            instance_graph_iri=instance_graph_iri,
            schema_id=schema_id,
        )

        return {
            "status": "ok",
            "message": "Schema and instances uploaded successfully",
            "schema": meta
        }
