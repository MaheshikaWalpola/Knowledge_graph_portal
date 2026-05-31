import re
import json
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Literal, Optional, Any

from services.local_llm_service import LocalLLMService
from services.graphdb_service import (
    resolve_schema_term_to_iri_global,
    search_schema_terms_global,
    neighbors_schema_and_instances_global,
    connected_classes_global,
    numeric_stats_for_class,
    find_graphs_by_name,
    resolve_term_in_graph,
    neighbors_in_uploaded_two_graphs,
    search_terms_in_graph,
    execute_safe_select,
    build_safe_sparql_query,
    graph_has_triples
)
from services.schema_service import get_ontology_schema
from core.auth import get_current_user
from services.user_schema_service import get_user_schema, list_user_schemas

router = APIRouter(prefix="/assistant", tags=["assistant"])
svc = LocalLLMService()


class ChatMsg(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatReq(BaseModel):
    messages: List[ChatMsg]
    selected_schema_id: Optional[str] = None


SCHEMA_HINTS = {
    "class", "classes", "property", "properties", "ontology", "schema",
    "relation", "relationship", "predicate", "iri", "instance", "instances",
    "type", "subclass", "domain", "range", "connected"
}

# General KG/semantic-web concepts that can be answered from common knowledge
# without querying the user's graph database.
GENERAL_KG_CONCEPTS = {
    "knowledge graph", "kg", "ontology", "rdf", "sparql", "owl", "triple",
    "turtle", "json-ld", "n-triples", "n3", "semantic web", "linked data",
    "namespace", "prefix", "iri", "uri", "blank node", "literal",
    "class", "subclass", "superclass", "instance", "individual", "property",
    "data property", "object property", "annotation property", "axiom",
    "inference", "reasoner", "shacl", "skos"
}


def is_general_concept_question(entity_term: str, question: str) -> bool:
    """
    Conservative keyword safety net: returns True ONLY for pure definitional
    questions like 'What is a KG?' that have no specific entity/ontology context.
    This fires ONLY when the LLM also sets requires_graphdb=False.
    """
    q = question.lower().strip().rstrip("?").rstrip(".")

    # If the question contains any specific-context signals, it is NOT general
    specific_signals = [" in ", " of ", " for ", " from ", " within ", " inside "]
    if any(sig in q for sig in specific_signals):
        return False

    # Must match "what is [a/an] <concept>" exactly
    for concept in GENERAL_KG_CONCEPTS:
        if q in (f"what is {concept}", f"what is a {concept}", f"what is an {concept}"):
            return True

    return False


def extract_connected_to_term(q: str) -> str:
    """
    Extract term after 'connected to ...' for questions like:
      'What classes are connected to Pressure'
    """
    m = re.search(r"connected\s+to\s+([A-Za-z0-9_:-]+)", q, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return q.strip()


def generate_options_for_stats(term: str, iri: str, graph_name: str = "") -> List[str]:
    """
    Generate meaningful follow-up options based on connected classes/entities.
    For example, if user asks for "average of Ripple Air Bag Pressure",
    suggest "average of [related_class]" from connected entities.
    """
    options = []
    
    try:
        # Get connected classes to this term
        connected = connected_classes_global(iri, limit=50)
        
        if not connected:
            return []
        
        # Extract unique labels/names from connected classes
        seen = set()
        for row in connected[:20]:  # Check first 20 connections
            label = row.get("label") or row.get("class", "").split("/")[-1]
            if label and label not in seen:
                seen.add(label)
                # Generate option text
                direction = "(" + row.get("direction", "related") + ")"
                options.append(f"Average of {label} {direction}")
                if len(options) >= 3:  # Limit to 3 suggestions
                    break
        
        return options
    except Exception as e:
        print(f"Error generating stat options: {e}")
        return []


def build_evidence_for_term(term: str, graph_name: str = "") -> str:
    matched_graphs = []
    if graph_name:
        matched_graphs = find_graphs_by_name(graph_name)
        
    if matched_graphs:
        out = []
        out.append(f"Matched {len(matched_graphs)} graphs for '{graph_name}'")
        for g_iri in matched_graphs:
            iri = resolve_term_in_graph(term, g_iri)
            if not iri:
                continue
                
            instance_g_iri = g_iri + "/instances"
            g = neighbors_in_uploaded_two_graphs(iri, g_iri, instance_g_iri, limit=400)
            edges = g.get("edges") or []
            nodes = g.get("nodes") or []
            
            out.append(f"\nGraph: {g_iri}")
            out.append(f"Resolved term '{term}' to IRI: {iri}")
            out.append(f"Edges (source --predicate--> target), count={len(edges)}:")
            for e in edges[:200]:
                out.append(f"{e['source']} -- {e['relation']} --> {e['target']}")
                
            out.append(f"Nodes (IRI | label), count={len(nodes)}:")
            for n in nodes[:200]:
                out.append(f"{n.get('iri')} | {n.get('label') or ''}")
                
        if len(out) > 1:
            return "\n".join(out)

    # Default to global resolution if graph wasn't provided or no matches found
    iri = resolve_schema_term_to_iri_global(term)

    if not iri:
        return ""

    g = neighbors_schema_and_instances_global(iri, limit=400)
    edges = g.get("edges") or []
    nodes = g.get("nodes") or []

    out = []
    out.append(f"Resolved term '{term}' to IRI: {iri}")
    out.append(f"Edges (source --predicate--> target), count={len(edges)}:")
    for e in edges[:200]:
        out.append(f"{e['source']} -- {e['relation']} --> {e['target']}")

    out.append(f"Nodes (IRI | label), count={len(nodes)}:")
    for n in nodes[:200]:
        out.append(f"{n.get('iri')} | {n.get('label') or ''}")

    return "\n".join(out)


#  SSE helpers

def _sse(event: str, data: dict) -> str:
    """Format a single SSE message."""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"

# Structured thinking event helpers
def _phase(label: str) -> str:
    return _sse("thinking", {"type": "phase", "label": label})

def _detail(key: str, value: str, mono: bool = False) -> str:
    return _sse("thinking", {"type": "detail", "key": key, "value": value, "mono": mono})

def _status(text: str) -> str:
    return _sse("thinking", {"type": "status", "text": text})

def _warn(text: str) -> str:
    return _sse("thinking", {"type": "warn", "text": text})

def _log(tag: str, text: str) -> str:
    return _sse("thinking", {"type": "log", "tag": tag, "text": text})


#  Streaming chat endpoint

@router.post("/chat/stream")
async def chat_stream(req: ChatReq, current_user: Any = Depends(get_current_user)):
    """
    Streaming version of /chat.
    Sends SSE events:
      - event: thinking  →  { type, label|key|value|text, mono? }
      - event: result    →  { answer, chart_data }
      - event: error     →  { detail }
    """

    async def generate():
        last_user = None
        for m in reversed(req.messages):
            if m.role == "user" and (m.content or "").strip():
                last_user = m.content.strip()
                break

        if not last_user:
            yield _sse("error", {"detail": "No user message provided."})
            return

        history = [{"role": m.role, "content": m.content} for m in req.messages]

        def _para(phase: str, text: str) -> str:
            """Emit a completed-phase paragraph."""
            return _sse("thinking", {"type": "para", "phase": phase, "text": text})

        try:
            # ── Step 1: Intent analysis ──────────────────────────────────────
            yield _log("SYS", "Initializing reasoning engine context")
            yield _log("NLP", f"Analyzing query tokens; sequence payload: {len(last_user)} characters")

            intent = svc.analyze_intent_and_clarify(last_user, history=history)

            needs_clarification = intent.get("needs_clarification", False)
            if needs_clarification:
                yield _sse("result", {
                    "answer": intent.get("clarification_message", "Please clarify your request."),
                    "options": []
                })
                return

            requires_graphdb = intent.get("requires_graphdb", True)
            extracted_ontology_name = intent.get("ontology_name", "").strip()
            data_scope = intent.get("data_scope", "schema")
            stat = intent.get("stat", "")
            intent_type = intent.get("intent", "complex_query")
            entity_term = intent.get("entity", "").strip()

            yield _log("NLP", f"Intent classification complete: label='{intent_type}'")
            yield _log("SYS", f"Pipeline route determined: scope='{data_scope}', stat='{stat or 'none'}'")

            # Check if general concept question
            is_general = (
                not requires_graphdb
                or is_general_concept_question(entity_term, last_user)
            )

            if is_general:
                yield _log("SYS", "Bypassing GraphDB execution route; direct reply matched")
                yield _log("NLP", "Synthesizing natural language response from base models")
                answer = svc.chat_general(last_user, history=history)
                yield _sse("result", {"answer": answer, "options": []})
                return

            # ── Step 2: Resolve ontology ─────────────────────────────────────
            yield _log("GRAPH", "Searching active ontology metadata mappings in repository")

            target_graphs = []
            schema_id = req.selected_schema_id
            graph_name = extracted_ontology_name
            short_schema = ""
            short_inst = ""

            meta = None
            if schema_id:
                meta = get_user_schema(current_user["email"], schema_id)
                if meta:
                    graph_name = meta.get("name", "selected schema")
            elif extracted_ontology_name:
                schemas = list_user_schemas(current_user["email"])
                matched = [s for s in schemas if extracted_ontology_name.lower() in s.get("name", "").lower()]
                if len(matched) == 1:
                    meta = matched[0]
                    schema_id = meta.get("schema_id")
                    graph_name = meta.get("name")
                elif len(matched) > 1:
                    yield _sse("result", {
                        "answer": f"I found multiple ontologies matching '{extracted_ontology_name}'. Please specify which one you mean (e.g., '{matched[0].get('name')}').",
                        "options": [s.get("name") for s in matched[:3]]
                    })
                    return
                else:
                    yield _sse("result", {
                        "answer": f"I could not find an ontology named '{extracted_ontology_name}'. Please specify a valid ontology.",
                        "options": []
                    })
                    return

            instance_graph_iri = None
            if meta and meta.get("graph_iri"):
                schema_graph_iri = meta["graph_iri"]
                target_graphs.append(schema_graph_iri)
                short_schema = schema_graph_iri.split("/")[-1]

                if meta.get("instance_graph_iri"):
                    instance_graph_iri = meta["instance_graph_iri"]
                else:
                    candidate = schema_graph_iri.rstrip("/") + "/instances"
                    if graph_has_triples(candidate):
                        instance_graph_iri = candidate

                if instance_graph_iri:
                    target_graphs.append(instance_graph_iri)
                    short_inst = instance_graph_iri.split("/")[-1]

                if data_scope == "instances" and not instance_graph_iri:
                    yield _sse("result", {
                        "answer": f"I found the ontology '{graph_name}', but I could not find an instance graph for it.",
                        "options": []
                    })
                    return

            if not target_graphs:
                yield _sse("result", {
                    "answer": "Please select an ontology or specify which ontology you are asking about.",
                    "options": []
                })
                return

            schema_graph_iri = target_graphs[0]

            yield _log("GRAPH", "Ontology definition loaded successfully")
            yield _log("GRAPH", f"Workspace bound: schema_graph='{short_schema or 'default'}', instance_graph='{short_inst or 'none'}'")

            # ── Step 3: Resolve entity IRI ───────────────────────────────────
            entity_iri = None
            if entity_term:
                yield _log("NLP", f"Resolving entity token sequence against schema vocabulary")
                entity_iri = resolve_term_in_graph(entity_term, schema_graph_iri)
                if not entity_iri:
                    entity_iri = resolve_schema_term_to_iri_global(entity_term)

                if entity_iri:
                    yield _log("GRAPH", "Matched term token to active schema IRI anchor")
                else:
                    yield _log("GRAPH", "No direct IRI mapping found; enabling lexical fallback query")

            # ── Step 4: Build SPARQL query ────────────────────────────────────
            yield _log("SPARQL", "Compiling SPARQL query template constraints")

            try:
                sparql_query = build_safe_sparql_query(intent_type, target_graphs, entity_iri, entity_term, stat)

                if sparql_query:
                    yield _log("SPARQL", "Deterministic query template compiled successfully")
                else:
                    yield _log("GRAPH", "Query requires relational context; fetching schematic subgraph")
                    schema_context, _ = get_ontology_schema(graph_name, target_graphs)
                    yield _log("SPARQL", "Invoking code generation transformer model for custom query")
                    sparql_query = svc.generate_sparql(last_user, schema_context)
                    for i, graph_iri in enumerate(target_graphs):
                        sparql_query = sparql_query.replace(f"<GRAPH_{i}>", f"<{graph_iri}>")
                    yield _log("SPARQL", "Synthesizing LLM-generated query structure")

                # ── Step 5: Execute SPARQL ────────────────────────────────────
                yield _log("DB", "Dispatching query payload to GraphDB server endpoint")
                raw_results = execute_safe_select(sparql_query)
                result_count = len(raw_results)
                yield _log("DB", f"Query executed successfully; returned {result_count} record rows")

                if not raw_results:
                    yield _sse("result", {
                        "answer": "I could not find matching information in the selected ontology.",
                        "options": []
                    })
                    return

                # ── Step 6: Format or explain results ────────────────────────
                if sparql_query and intent_type == "get_numeric_stat":
                    if stat == "plot":
                        yield _log("SYS", "Generating plot coordinate arrays and value sequences")
                        chart_data = []
                        for i, r in enumerate(raw_results):
                            if "value" in r:
                                try:
                                    v = float(r["value"])
                                    lbl = r.get("label", f"Instance {i+1}")
                                    chart_data.append({"name": lbl, "value": v})
                                except:
                                    pass
                        if not chart_data:
                            yield _sse("result", {"answer": f"I found the '{entity_term}' class, but no numeric instance values were found to plot.", "options": []})
                            return
                        yield _sse("result", {
                            "answer": f"Here is the chart of {entity_term} values from {graph_name} instances:",
                            "options": [],
                            "chart_data": chart_data
                        })
                        return

                    row = raw_results[0]
                    count = int(row.get("count", "0"))
                    if count == 0:
                        yield _sse("result", {"answer": f"I found the '{entity_term}' class, but no numeric instance values were found for it in the selected instance graph.", "options": []})
                        return

                    val = ""
                    stat_name = ""
                    if stat == "max":
                        val = row.get("max"); stat_name = "maximum"
                    elif stat == "min":
                        val = row.get("min"); stat_name = "minimum"
                    elif stat in ("avg", "mean"):
                        val = row.get("avg"); stat_name = "average"

                    if val:
                        try: val = f"{float(val):.2f}"
                        except: pass
                        yield _sse("result", {"answer": f"The {stat_name} value of {entity_term} in {graph_name} instances is {val}.", "options": []})
                        return
                    elif stat == "count":
                        yield _sse("result", {"answer": f"There are {count} numeric instance values for {entity_term} in {graph_name}.", "options": []})
                        return
                    else:
                        ans = [f"Found {count} numeric values for {entity_term}."]
                        if row.get("min"): ans.append(f"Min: {float(row.get('min')):.2f}")
                        if row.get("max"): ans.append(f"Max: {float(row.get('max')):.2f}")
                        if row.get("avg"): ans.append(f"Average: {float(row.get('avg')):.2f}")
                        yield _sse("result", {"answer": "\n".join(ans), "options": []})
                        return

                # Simple list results — format locally
                if sparql_query and intent_type != "complex_query" and 0 < result_count <= 100:
                    yield _log("SYS", "Applying schematic result list parsing templates")
                    lines = []
                    for row in raw_results:
                        label = row.get("label")
                        if not label:
                            for k, v in row.items():
                                if k != "label" and isinstance(v, str):
                                    label = v.split("#")[-1].split("/")[-1]
                                    break
                        lines.append(f"- {label or 'Unknown'}")
                    answer = "Here are the results:\n" + "\n".join(lines)
                    yield _sse("result", {"answer": answer, "options": []})
                    return
                else:
                    yield _log("NLP", "Formatting relational tuples into final natural language response")
                    answer = svc.answer_from_sparql_results(last_user, str(raw_results), history=history)
                    yield _sse("result", {"answer": answer, "options": []})
                    return

            except Exception as query_err:
                print(f"[ERROR] Dynamic SPARQL pipeline failed: {query_err}")
                yield _sse("result", {
                    "answer": f"I encountered an error trying to query the graph database: {str(query_err)}",
                    "options": []
                })
                return

        except Exception as e:
            print(f"[ERROR] Chat stream failure: {e}")
            yield _sse("error", {"detail": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


#  Original (non-streaming) chat endpoint — kept unchanged

@router.post("/chat")
def chat(req: ChatReq, current_user: Any = Depends(get_current_user)):
    last_user = None
    for m in reversed(req.messages):
        if m.role == "user" and (m.content or "").strip():
            last_user = m.content.strip()
            break

    if not last_user:
        raise HTTPException(status_code=400, detail="No user message provided.")

    history = [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        qlow = last_user.lower().strip()
        
        m_avg = re.search(r"\b(average|avg|mean)\b", qlow)
        is_connected_q = "classes" in qlow and "connected to" in qlow

        # Always analyze intent to extract entity_term or clarify
        intent = svc.analyze_intent_and_clarify(last_user, history=history)
        
        needs_clarification = intent.get("needs_clarification", False)
        if needs_clarification:
            return {
                "answer": intent.get("clarification_message", "Please clarify your request."),
                "options": []
            }

        requires_graphdb = intent.get("requires_graphdb", True)
        extracted_ontology_name = intent.get("ontology_name", "").strip()
        data_scope = intent.get("data_scope", "schema")
        stat = intent.get("stat", "")
        intent_type = intent.get("intent", "complex_query")
        entity_term = intent.get("entity", "").strip()
        property_term = intent.get("property", "").strip()

        # Check if it's a general concept question not needing GraphDB
        is_general = (
            not requires_graphdb
            or is_general_concept_question(entity_term, last_user)
        )

        if is_general:
            answer = svc.chat_general(last_user, history=history)
            return {"answer": answer, "options": []}

        # --- Resolve Ontology ---
        target_graphs = []
        schema_id = req.selected_schema_id
        graph_name = extracted_ontology_name
        
        meta = None
        if schema_id:
            # Use frontend selection
            meta = get_user_schema(current_user["email"], schema_id)
            if meta:
                graph_name = meta.get("name", "selected schema")
        elif extracted_ontology_name:
            # Try to match extracted name
            schemas = list_user_schemas(current_user["email"])
            matched = [s for s in schemas if extracted_ontology_name.lower() in s.get("name", "").lower()]
            if len(matched) == 1:
                meta = matched[0]
                schema_id = meta.get("schema_id")
                graph_name = meta.get("name")
            elif len(matched) > 1:
                return {
                    "answer": f"I found multiple ontologies matching '{extracted_ontology_name}'. Please specify which one you mean (e.g., '{matched[0].get('name')}').",
                    "options": [s.get("name") for s in matched[:3]]
                }
            else:
                return {
                    "answer": f"I could not find an ontology named '{extracted_ontology_name}'. Please specify a valid ontology.",
                    "options": []
                }
        
        if meta and meta.get("graph_iri"):
            schema_graph_iri = meta["graph_iri"]
            target_graphs.append(schema_graph_iri)
            
            instance_graph_iri = None
            if meta.get("instance_graph_iri"):
                instance_graph_iri = meta["instance_graph_iri"]
            else:
                candidate = schema_graph_iri.rstrip("/") + "/instances"
                if graph_has_triples(candidate):
                    instance_graph_iri = candidate
                    
            if instance_graph_iri:
                target_graphs.append(instance_graph_iri)
                
            if data_scope == "instances" and not instance_graph_iri:
                return {
                    "answer": f"I found the ontology '{graph_name}', but I could not find an instance graph for it.",
                    "options": []
                }
        
        if not target_graphs:
            return {
                "answer": "Please select an ontology or specify which ontology you are asking about.",
                "options": []
            }

        schema_graph_iri = target_graphs[0] if len(target_graphs) > 0 else "None"
        instance_graph_iri_log = target_graphs[1] if len(target_graphs) > 1 else "None"

        print(f"[DEBUG] === KG Chat Request ===")
        print(f"[DEBUG] User Message: {last_user}")
        print(f"[DEBUG] selected_schema_id: {schema_id}")
        print(f"[DEBUG] extracted ontology_name: {extracted_ontology_name}")
        print(f"[DEBUG] resolved schema_graph_iri: {schema_graph_iri}")
        print(f"[DEBUG] resolved instance_graph_iri: {instance_graph_iri_log}")
        print(f"[DEBUG] intent: {intent_type}")
        print(f"[DEBUG] stat: {stat}")
        print(f"[DEBUG] entity: {entity_term}")
        
        # --- Resolve Entity ---
        entity_iri = None
        if entity_term:
            primary_graph = target_graphs[0]
            entity_iri = resolve_term_in_graph(entity_term, primary_graph)
            if not entity_iri:
                entity_iri = resolve_schema_term_to_iri_global(entity_term)
            
        print(f"[DEBUG] resolved entity IRI: {entity_iri}")

        # --- Dynamic SPARQL Generation Pipeline ---
        try:
            print(f"[DEBUG] Starting dynamic SPARQL pipeline for graph: {graph_name}")
            
            sparql_query = build_safe_sparql_query(intent_type, target_graphs, entity_iri, entity_term, stat)
            
            if sparql_query:
                print(f"[DEBUG] Using deterministic safe SPARQL builder for intent '{intent_type}'")
            else:
                print(f"[DEBUG] Fetching schema context for complex query...")
                schema_context, _ = get_ontology_schema(graph_name, target_graphs)
                
                print(f"[DEBUG] Requesting LLM to generate SPARQL...")
                sparql_query = svc.generate_sparql(last_user, schema_context)
                
                for i, graph_iri in enumerate(target_graphs):
                    sparql_query = sparql_query.replace(f"<GRAPH_{i}>", f"<{graph_iri}>")
                    
            print(f"[DEBUG] generated deterministic SPARQL:\n{sparql_query}\n")
            
            print(f"[DEBUG] Executing SPARQL query against GraphDB...")
            raw_results = execute_safe_select(sparql_query)
            print(f"[DEBUG] row count: {len(raw_results)}")
            
            if not raw_results:
                return {
                    "answer": "I could not find matching information in the selected ontology.",
                    "options": []
                }
                
            if sparql_query and intent_type == "get_numeric_stat":
                if stat == "plot":
                    chart_data = []
                    for i, r in enumerate(raw_results):
                        if "value" in r:
                            try:
                                v = float(r["value"])
                                lbl = r.get("label", f"Instance {i+1}")
                                chart_data.append({"name": lbl, "value": v})
                            except:
                                pass
                    if not chart_data:
                        return {"answer": f"I found the '{entity_term}' class, but no numeric instance values were found to plot.", "options": []}
                        
                    return {
                        "answer": f"Here is the chart of {entity_term} values from {graph_name} instances:",
                        "options": [],
                        "chart_data": chart_data
                    }
                    
                row = raw_results[0]
                count = int(row.get("count", "0"))
                print(f"[DEBUG] count of numeric values: {count}")
                if count == 0:
                    return {"answer": f"I found the '{entity_term}' class, but no numeric instance values were found for it in the selected instance graph.", "options": []}
                
                val = ""
                stat_name = ""
                if stat == "max":
                    val = row.get("max")
                    stat_name = "maximum"
                elif stat == "min":
                    val = row.get("min")
                    stat_name = "minimum"
                elif stat == "avg" or stat == "mean":
                    val = row.get("avg")
                    stat_name = "average"
                    
                if val:
                    try:
                        val = f"{float(val):.2f}"
                    except:
                        pass
                    return {"answer": f"The {stat_name} value of {entity_term} in {graph_name} instances is {val}.", "options": []}
                elif stat == "count":
                    return {"answer": f"There are {count} numeric instance values for {entity_term} in {graph_name}.", "options": []}
                else:
                    ans = [f"Found {count} numeric values for {entity_term}."]
                    if row.get("min"): ans.append(f"Min: {float(row.get('min')):.2f}")
                    if row.get("max"): ans.append(f"Max: {float(row.get('max')):.2f}")
                    if row.get("avg"): ans.append(f"Average: {float(row.get('avg')):.2f}")
                    return {"answer": "\n".join(ans), "options": []}
                    
            # For simple list results from our builders, format them locally without LLM overhead
            if sparql_query and intent_type != "complex_query" and len(raw_results) > 0 and len(raw_results) <= 100:
                lines = []
                for row in raw_results:
                    # Try to find a label or the last part of an IRI
                    label = row.get("label")
                    if not label:
                        for k, v in row.items():
                            if k != "label" and isinstance(v, str):
                                val = v.split("#")[-1].split("/")[-1]
                                label = val
                                break
                    lines.append(f"- {label or 'Unknown'}")
                answer = "Here are the results:\n" + "\n".join(lines)
                return {"answer": answer, "options": []}
            else:
                answer = svc.answer_from_sparql_results(last_user, str(raw_results), history=history)
                return {"answer": answer, "options": []}

        except Exception as query_err:
            print(f"[ERROR] Dynamic SPARQL pipeline failed: {query_err}")
            return {
                "answer": f"I encountered an error trying to query the graph database: {str(query_err)}",
                "options": []
            }

    except Exception as e:
        print(f"[ERROR] Chat failure: {e}")
        raise HTTPException(status_code=500, detail=str(e))
