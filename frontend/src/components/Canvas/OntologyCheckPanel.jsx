import React from "react";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CHECK_TOOLTIP, shortIri, summaryText } from "./ontologyCheck";
import "./OntologyCheck.css";

function ProblemRow({ problem, nodeIds, labelFor, onFocus, active }) {
  const onCanvas = nodeIds.length > 0;
  const name = onCanvas ? labelFor(nodeIds[0]) : shortIri(problem.iri);
  return (
    <li
      className={`ce-check-item ${problem.severity} ${onCanvas ? "clickable" : ""} ${active ? "active" : ""}`}
      onClick={onCanvas ? () => onFocus(nodeIds[0]) : undefined}
      title={problem.iri || ""}
    >
      <div className="ce-check-item-head">
        <span className={`ce-check-dot ${problem.severity}`} />
        <span className="ce-check-item-name">{name}</span>
        <span className="ce-check-item-code">{problem.code}</span>
      </div>
      <div className="ce-check-item-msg">{problem.message}</div>
      {problem.related?.length > 0 && (
        <div className="ce-check-item-related">Related: {problem.related.map(shortIri).join(", ")}</div>
      )}
    </li>
  );
}

export default function OntologyCheckPanel({
  result,
  running,
  error,
  stale,
  autoCheck,
  onToggleAutoCheck,
  onCheckCanvas,
  onCheckStored,
  canCheckStored,
  highlights,
  labelFor,
  selectedNodeId,
  onFocus,
  onClose,
}) {
  const problems = result?.problems || [];
  const idsFor = (p) => (p.iri && highlights.idsByIri[p.iri]) || [];
  const onCanvas = problems.filter((p) => idsFor(p).length > 0);
  const selectedProblems = selectedNodeId ? highlights.byNode[selectedNodeId]?.problems || [] : [];
  const row = (p, i, keyPrefix) => (
    <ProblemRow
      key={`${keyPrefix}-${i}`}
      problem={p}
      nodeIds={idsFor(p)}
      labelFor={labelFor}
      onFocus={onFocus}
      active={selectedNodeId && idsFor(p).includes(selectedNodeId)}
    />
  );

  return (
    <div className="ce-check-panel">
      <div className="ce-check-header">
        <strong>Ontology check</strong>
        {result && (
          <span className={`ce-check-summary ${result.summary.errors ? "has-errors" : result.summary.warnings ? "has-warnings" : "ok"}`}>
            {summaryText(result.summary)}
          </span>
        )}
        <span className="ce-check-info" title={CHECK_TOOLTIP}>
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </span>
        <button className="ce-check-close" onClick={onClose} title="Close">
          <CloseIcon sx={{ fontSize: 16 }} />
        </button>
      </div>

      <div className="ce-check-actions">
        <button onClick={onCheckCanvas} disabled={running} title={CHECK_TOOLTIP}>
          Check canvas
        </button>
        <button
          onClick={onCheckStored}
          disabled={running || !canCheckStored}
          title={canCheckStored
            ? "Check the saved version of this schema, including OWL axioms the canvas can't show (e.g. disjointness)"
            : "Save the schema first, or open it from your workspace, to check the stored version"}
        >
          Check saved schema
        </button>
        <label className="ce-check-auto" title="Check the canvas automatically a few seconds after each edit">
          <input type="checkbox" checked={autoCheck} onChange={(e) => onToggleAutoCheck(e.target.checked)} />
          Auto
        </label>
      </div>

      {running && <div className="ce-check-status">Checking…</div>}
      {error && <div className="ce-check-error">{error}</div>}
      {stale && result && !running && (
        <div className="ce-check-stale">The ontology changed since this check; highlights are outdated.</div>
      )}
      {result?.source === "stored" && (
        <div className="ce-check-status">
          Showing the check of the saved schema, which includes OWL axioms the canvas can't show.
        </div>
      )}

      {!result && !running && !error && (
        <div className="ce-check-empty">Run a check to see errors and warnings on the canvas.</div>
      )}

      {result && problems.length === 0 && <div className="ce-check-empty">No problems found.</div>}

      {selectedProblems.length > 0 && (
        <div className="ce-check-section">
          <div className="ce-check-section-title">Selected: {labelFor(selectedNodeId)}</div>
          <ul>{selectedProblems.map((p, i) => row(p, i, "sel"))}</ul>
        </div>
      )}

      {onCanvas.length > 0 && (
        <div className="ce-check-section">
          <div className="ce-check-section-title">On the canvas</div>
          <ul>{onCanvas.map((p, i) => row(p, i, "on"))}</ul>
        </div>
      )}

      {highlights.unmatched.length > 0 && (
        <div className="ce-check-section">
          <div className="ce-check-section-title" title="These terms have no node on the canvas (e.g. imported terms)">
            Not on the canvas
          </div>
          <ul>{highlights.unmatched.map((p, i) => row(p, i, "off"))}</ul>
        </div>
      )}

      {result?.notes?.length > 0 && (
        <ul className="ce-check-notes">
          {result.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
