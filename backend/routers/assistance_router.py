# routers/assistant_router.py
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Literal, Optional

from services.local_llm_service import LocalLLMService
from services.graphdb_service import (
    resolve_schema_term_to_iri_global,
    search_schema_terms_global,
    neighbors_schema_and_instances_global,
    connected_classes_global,
    numeric_stats_for_class,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])
svc = LocalLLMService()


class ChatMsg(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatReq(BaseModel):
    messages: List[ChatMsg]


SCHEMA_HINTS = {
    "class", "classes", "property", "properties", "ontology", "schema",
    "relation", "relationship", "predicate", "iri", "instance", "instances",
    "type", "subclass", "domain", "range", "connected"
}


def extract_connected_to_term(q: str) -> str:
    """
    Extract term after 'connected to ...' for questions like:
      'What classes are connected to Pressure'
    """
    m = re.search(r"connected\s+to\s+([A-Za-z0-9_:-]+)", q, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return q.strip()


def build_evidence_for_term(term: str) -> str:
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


@router.post("/chat")
def chat(req: ChatReq):
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
        
        if not intent.get("is_clear", True):
            raw_options = intent.get("options", [])
            safe_options = []
            for opt in raw_options:
                if isinstance(opt, str):
                    safe_options.append(opt)
                elif isinstance(opt, dict) and "option" in opt:
                    safe_options.append(str(opt["option"]))
                elif isinstance(opt, dict) and len(opt) > 0:
                    safe_options.append(str(list(opt.values())[0]))
                else:
                    safe_options.append(str(opt))
            
            return {
                "answer": intent.get("clarification_message", "Please clarify your request."),
                "options": safe_options
            }

        entity_term = intent.get("entity_term") or last_user.strip()

        # Special intent: average/avg/mean of a term (numeric instance stats)
        if m_avg:
            # extract term after "of" or "for" if present
            m_term = re.search(
                r"\b(?:average|avg|mean)\s+(?:of|for)\s+(.+)$",
                last_user,
                flags=re.IGNORECASE
            )
            term = (m_term.group(1).strip() if m_term else entity_term)

            iri = resolve_schema_term_to_iri_global(term)
            if not iri:
                candidates = search_schema_terms_global(term, limit=10)
                if not candidates:
                    return {"answer": f"'{term}' was not found in the base schema graph.", "options": []}

                options = [c.get("label") or c["iri"].split("/")[-1] for c in candidates]
                return {
                    "answer": f"'{term}' was not found. Did you mean:",
                    "options": options
                }

            stats = numeric_stats_for_class(iri)
            if not stats or stats["count"] == 0 or stats["avg"] is None:
                return {"answer": f"No numeric instance values found for '{term}'.", "options": []}

            return {
                "answer": (
                    f"Stats for {term}:\n"
                    f"- count: {stats['count']}\n"
                    f"- avg: {stats['avg']}\n"
                    f"- min: {stats['min']}\n"
                    f"- max: {stats['max']}"
                ),
                "options": []
            }

        # 2) Special intent: "What classes are connected to X"
        if is_connected_q:
            term = extract_connected_to_term(last_user)
            iri = resolve_schema_term_to_iri_global(term)

            if not iri:
                answer = svc.chat_general(
                    f"{last_user}\n\nNote: '{term}' was not found in the base schema.", history=history
                )
                return {"answer": answer, "options": []}

            rows = connected_classes_global(iri, limit=200)
            if not rows:
                return {"answer": f"No connected classes found for '{term}' in the base schema.", "options": []}

            evidence_lines = [
                f"Target class IRI: {iri}",
                "Connected classes (label | classIRI | direction | relationIRI):",
            ]
            for r in rows[:80]:
                label = r.get("label") or r["class"].split("/")[-1]
                evidence_lines.append(
                    f"{label} | {r['class']} | {r['direction']} | {r['relation']}"
                )

            answer = svc.chat_grounded(
                f"What classes are connected to {term}?",
                evidence="\n".join(evidence_lines), history=history
            )
            return {"answer": answer, "options": []}

        # 3) Default routing using extracted entity_term
        term = entity_term
        iri = resolve_schema_term_to_iri_global(term)
        
        if not iri:
            # Disambiguate if possible
            candidates = search_schema_terms_global(term, limit=10)
            if candidates:
                options = [c.get("label") or c["iri"].split("/")[-1] for c in candidates]
                return {
                    "answer": f"Multiple or fuzzy matches found for '{term}'. Did you mean:",
                    "options": options
                }
            else:
                # If even the extracted entity isn't in graphDB, try raw last_user
                candidates_raw = search_schema_terms_global(last_user.strip(), limit=10)
                if candidates_raw:
                    options = [c.get("label") or c["iri"].split("/")[-1] for c in candidates_raw]
                    return {
                        "answer": f"Multiple matches found. Did you mean:",
                        "options": options
                    }
                evidence = ""
        else:
            evidence = build_evidence_for_term(term)

        if not evidence:
            if intent.get("requires_graphdb", True):
                answer = svc.chat_grounded(last_user, evidence="", history=history)
            else:
                answer = svc.chat_general(last_user, history=history)
        else:
            answer = svc.chat_grounded(last_user, evidence=evidence, history=history)

        return {"answer": answer, "options": []}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
