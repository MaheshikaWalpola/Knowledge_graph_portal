import React from "react";

// Corner badge plus a tooltip with the node's messages, shown when the node is hovered.
export default function CheckMarker({ mark }) {
  if (!mark) return null;
  const count = mark.problems.length;
  return (
    <>
      <span
        className={`onto-check-badge ${mark.severity}${mark.stale ? " stale" : ""}`}
        aria-label={`${count} ontology check ${count === 1 ? "problem" : "problems"}`}
      >
        {mark.severity === "error" ? "!" : count}
      </span>
      <div className="onto-check-tip" role="tooltip">
        {mark.stale && <div className="onto-check-tip-stale">Outdated: the ontology changed since this check</div>}
        {mark.problems.map((p, i) => (
          <div key={i} className={`onto-check-tip-row ${p.severity}`}>
            <span className="onto-check-tip-code">{p.code}</span> {p.message}
          </div>
        ))}
      </div>
    </>
  );
}
