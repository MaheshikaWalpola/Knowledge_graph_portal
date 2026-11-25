// Helpers for the live ontology check on the canvas (POST /ontology/check).
import { createContext, useContext } from "react";

// Per-node highlight data for the node shapes: { byNode: { [nodeId]: { severity, problems } }, stale }
export const CheckHighlightContext = createContext({ byNode: {}, stale: false });

export function useNodeCheck(nodeId) {
  const { byNode, stale } = useContext(CheckHighlightContext);
  const mark = byNode[nodeId];
  return mark ? { ...mark, stale } : null;
}

// Class names for a node's check highlight (red border for errors, yellow for warnings).
export function checkClassName(mark) {
  if (!mark) return "";
  return `check-${mark.severity}${mark.stale ? " check-stale" : ""}`;
}

export function summaryText(summary) {
  if (!summary) return "";
  const e = summary.errors || 0;
  const w = summary.warnings || 0;
  return `${e} ${e === 1 ? "error" : "errors"}, ${w} ${w === 1 ? "warning" : "warnings"}`;
}

export const CHECK_TOOLTIP =
  "Quick OWL RL consistency check, not complete OWL 2 DL reasoning: some contradictions are not found. " +
  "The canvas only holds classes, properties, labels, subClassOf, domain and range, so red errors are " +
  "unlikely from canvas content. Use “Check saved schema” to include disjointness and other OWL axioms.";

// The prefixes buildTTL (CanvasEditor.jsx) declares; keep them in step with it.
const PREFIXES = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  ex: "http://example.org/ontology#",
};

// The full IRI buildTTL writes for a node (same rule as its nodeMap), so results can be matched.
export function nodeIri(node) {
  const iri = node.data?.iri || `ex:${(node.data?.label || node.id).replace(/\s+/g, "")}`;
  if (iri.startsWith("http://") || iri.startsWith("https://")) return iri;
  const colon = iri.indexOf(":");
  if (colon > 0) {
    const ns = PREFIXES[iri.slice(0, colon)];
    if (ns) return ns + iri.slice(colon + 1);
  }
  return iri;
}

export function shortIri(iri) {
  if (!iri) return "(no IRI)";
  const trimmed = iri.replace(/[#/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("#"), trimmed.lastIndexOf("/"));
  return cut >= 0 ? trimmed.slice(cut + 1) || iri : iri;
}

// Match the check result to canvas nodes. Problems whose IRI has no node land in `unmatched`.
export function buildHighlights(result, nodes) {
  const byNode = {};
  const unmatched = [];
  const idsByIri = {};
  for (const n of nodes || []) {
    const iri = nodeIri(n);
    (idsByIri[iri] = idsByIri[iri] || []).push(n.id);
  }
  for (const problem of result?.problems || []) {
    const ids = (problem.iri && idsByIri[problem.iri]) || [];
    if (ids.length === 0) {
      unmatched.push(problem);
      continue;
    }
    for (const id of ids) {
      const mark = (byNode[id] = byNode[id] || { severity: "warning", problems: [] });
      mark.problems.push(problem);
      if (problem.severity === "error") mark.severity = "error";
    }
  }
  return { byNode, unmatched, idsByIri };
}
