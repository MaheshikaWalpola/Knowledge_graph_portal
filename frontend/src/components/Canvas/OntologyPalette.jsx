import React, { useState, useMemo } from "react";

const PALETTE_ITEMS = [
  {
    type: "classNode",
    label: "Class",
    category: "classes",
    color: "#3b82f6",
    icon: (
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none" stroke="#3b82f6" strokeWidth="2">
        <rect x="2" y="2" width="36" height="24" rx="6" />
      </svg>
    ),
  },
  {
    type: "propertyNode",
    label: "Object Property",
    category: "properties",
    color: "#f59e0b",
    propertyType: "object",
    icon: (
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none" stroke="#f59e0b" strokeWidth="2">
        <path d="M20 2 L38 14 L20 26 L2 14 Z" />
      </svg>
    ),
  },
  {
    type: "propertyNode",
    label: "Data Property",
    category: "properties",
    color: "#e11d48",
    propertyType: "datatype",
    icon: (
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none" stroke="#e11d48" strokeWidth="2">
        <path d="M20 2 L38 14 L20 26 L2 14 Z" />
        <circle cx="20" cy="14" r="2.5" fill="#e11d48" />
      </svg>
    ),
  },
  {
    type: "instanceNode",
    label: "Instance",
    category: "instances",
    color: "#10b981",
    icon: (
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none" stroke="#10b981" strokeWidth="2">
        <circle cx="20" cy="14" r="12" />
      </svg>
    ),
  },
  {
    type: "literalNode",
    label: "Literal",
    category: "instances",
    color: "#8b5cf6",
    icon: (
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none" stroke="#8b5cf6" strokeWidth="2">
        <rect x="4" y="6" width="32" height="16" rx="8" />
      </svg>
    ),
  },
];

const EDGE_ITEMS = [
  { type: "subClassOf", label: "subClassOf", color: "#6366f1" },
  { type: "domain", label: "domain", color: "#14b8a6" },
  { type: "range", label: "range", color: "#f97316" },
  { type: "rdfType", label: "rdf:type", color: "#8b5cf6" },
];

const CATEGORIES = {
  classes: "Classes",
  properties: "Properties",
  instances: "Instances & Literals",
};

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="palette-section">
      <button className="palette-section-header" onClick={() => setOpen(!open)} type="button">
        <span className={`palette-chevron ${open ? "open" : ""}`}>▾</span>
        <span>{title}</span>
      </button>
      {open && <div className="palette-section-body">{children}</div>}
    </div>
  );
}

export default function OntologyPalette({ activeEdgeType, onEdgeTypeChange }) {
  const grouped = useMemo(() => {
    const g = { classes: [], properties: [], instances: [] };
    PALETTE_ITEMS.forEach((item) => {
      if (g[item.category]) g[item.category].push(item);
    });
    return g;
  }, []);

  const onDragStart = (event, item) => {
    event.dataTransfer.setData("application/reactflow", item.type);
    event.dataTransfer.setData("node/label", item.label);
    event.dataTransfer.setData("node/color", item.color);
    if (item.propertyType) {
      event.dataTransfer.setData("node/propertyType", item.propertyType);
    }
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="ontology-palette">
      <div className="palette-title">Elements</div>

      {Object.entries(CATEGORIES).map(([key, title]) => (
        <Section key={key} title={title} defaultOpen>
          <div className="palette-grid">
            {grouped[key].map((item, idx) => (
              <div
                key={`${item.type}-${idx}`}
                className="palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                title={`Drag: ${item.label}`}
              >
                <div className="palette-item-icon">{item.icon}</div>
                <div className="palette-item-label">{item.label}</div>
              </div>
            ))}
          </div>
        </Section>
      ))}

      <Section title="Connections" defaultOpen>
        <div className="palette-edge-list">
          {EDGE_ITEMS.map((edge) => (
            <button
              key={edge.type}
              className={`palette-edge-btn ${activeEdgeType === edge.type ? "active" : ""}`}
              onClick={() => onEdgeTypeChange(edge.type)}
              type="button"
            >
              <span className="palette-edge-line" style={{ backgroundColor: edge.color }} />
              <span>{edge.label}</span>
            </button>
          ))}
        </div>
      </Section>
    </aside>
  );
}
