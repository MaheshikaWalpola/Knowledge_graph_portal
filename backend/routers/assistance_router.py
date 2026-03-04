# routers/assistant_router.py
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Literal

from services.openai_service import OpenAIService
from services.graphdb_service import (
    resolve_schema_term_to_iri,
    search_base_schema_terms,
    neighbors_schema_and_instances,
    connected_classes_in_base_schema,
    numeric_stats_for_class,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])
svc = OpenAIService()


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


def is_general_definition_question(text: str) -> bool:
    low = (text or "").strip().lower()
    return low.startswith(("what is", "who is", "explain", "define", "how does", "how to"))


def should_query_graphdb(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False

    low = t.lower()

    # General "ChatGPT-style" questions should not force GraphDB
    if is_general_definition_question(low):
        return False

    # Explicit schema/instance intent
    if any(k in low for k in SCHEMA_HINTS):
        return True

    # Short term like "Pressure" / "MRR" / "Sensor"
    tokens = re.findall(r"[A-Za-z0-9_:-]+", t)
    return len(tokens) <= 3


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
    iri = resolve_schema_term_to_iri(term)

    if not iri:
        candidates = search_base_schema_terms(term, limit=10)
        if not candidates:
            return "No matching terms found in the base schema graph."
        lines = ["Candidates found in base schema:"]
        for c in candidates:
            lines.append(f"{c.get('label') or ''} | {c['iri']}")
        return "\n".join(lines)

    g = neighbors_schema_and_instances(iri, limit=400)
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

    try:
        qlow = last_user.lower().strip()

        # Special intent: average/avg/mean of a term (numeric instance stats)
        m_avg = re.search(r"\b(average|avg|mean)\b", qlow)
        if m_avg:
            # extract term after "of" or "for" if present
            m_term = re.search(
                r"\b(?:average|avg|mean)\s+(?:of|for)\s+(.+)$",
                last_user,
                flags=re.IGNORECASE
            )
            term = (m_term.group(1).strip() if m_term else last_user.strip())

            iri = resolve_schema_term_to_iri(term)
            if not iri:
                candidates = search_base_schema_terms(term, limit=10)
                if not candidates:
                    return {"answer": f"'{term}' was not found in the base schema graph."}

                lines = [f"'{term}' was not found. Did you mean:"]
                for c in candidates:
                    label = c.get("label") or c["iri"].split("/")[-1]
                    lines.append(f"- {label} | {c['iri']}")
                return {"answer": "\n".join(lines)}

            stats = numeric_stats_for_class(iri)
            if not stats or stats["count"] == 0 or stats["avg"] is None:
                return {"answer": f"No numeric instance values found for '{term}'."}

            return {
                "answer": (
                    f"Stats for {term}:\n"
                    f"- count: {stats['count']}\n"
                    f"- avg: {stats['avg']}\n"
                    f"- min: {stats['min']}\n"
                    f"- max: {stats['max']}"
                )
            }

        # 1) Always allow general definition questions (no GraphDB grounding)
        if is_general_definition_question(last_user):
            return {"answer": svc.chat_general(last_user)}

        # 2) Special intent: "What classes are connected to X"
        if "classes" in qlow and "connected to" in qlow:
            term = extract_connected_to_term(last_user)
            iri = resolve_schema_term_to_iri(term)

            if not iri:
                answer = svc.chat_general(
                    f"{last_user}\n\nNote: '{term}' was not found in the base schema."
                )
                return {"answer": answer}

            rows = connected_classes_in_base_schema(iri, limit=200)
            if not rows:
                return {"answer": f"No connected classes found for '{term}' in the base schema."}

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
                evidence="\n".join(evidence_lines),
            )
            return {"answer": answer}

        # 3) Default routing
        if should_query_graphdb(last_user):
            evidence = build_evidence_for_term(last_user)

            if (
                not evidence
                or evidence.startswith("No matching terms")
                or evidence.startswith("Candidates found")
            ):
                answer = svc.chat_general(last_user)
            else:
                answer = svc.chat_grounded(last_user, evidence=evidence)
        else:
            answer = svc.chat_general(last_user)

        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
