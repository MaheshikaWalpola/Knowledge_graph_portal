import React, { useState, useRef } from "react";

const EDGE_TYPE_OPTIONS = [
  { value: "subClassOf", label: "rdfs:subClassOf" },
  { value: "domain", label: "rdfs:domain" },
  { value: "range", label: "rdfs:range" },
  { value: "rdfType", label: "rdf:type" },
];

function ElementTab({ selected, model }) {
  if (!selected) {
    return (
      <div className="pp-empty">
        <p>Select a node or edge on the canvas to view its properties.</p>
      </div>
    );
  }

  if (selected.kind === "node") {
    const liveNode = model?.nodes?.find((n) => n.id === selected.id) || selected;
    const data = liveNode.data || {};
    
    // Map internal node types to human-readable strings
    let nodeTypeDisplay = "Unknown Node";
    if (selected.type === "classNode") nodeTypeDisplay = "Class";
    if (selected.type === "instanceNode") nodeTypeDisplay = "Instance";
    if (selected.type === "literalNode") nodeTypeDisplay = "Literal";
    if (selected.type === "propertyNode") {
      nodeTypeDisplay = data.propertyType === "datatype" ? "Data Property" : "Object Property";
    }

    return (
      <div className="pp-fields">
        <div className="pp-field">
          <label>Label</label>
          <input
            type="text"
            value={data.label || ""}
            onChange={(e) => selected.setLabel?.(e.target.value)}
          />
        </div>
        <div className="pp-field">
          <label>Element Type</label>
          <input
            type="text"
            value={nodeTypeDisplay}
            disabled
            style={{ backgroundColor: "#f8fafc", color: "#64748b", cursor: "not-allowed" }}
          />
        </div>
        <div className="pp-field">
          <label>IRI</label>
          <input
            type="text"
            value={data.iri || ""}
            onChange={(e) => selected.setIri?.(e.target.value)}
            placeholder="e.g. http://example.org/MyClass"
          />
        </div>
        <div className="pp-field">
          <label>Description</label>
          <textarea
            value={data.description || ""}
            onChange={(e) => selected.setDescription?.(e.target.value)}
            rows={3}
            placeholder="Optional description..."
          />
        </div>
        <div className="pp-info">
          <span className="pp-badge">{selected.type}</span>
          <span className="pp-id">ID: {selected.id}</span>
        </div>
      </div>
    );
  }

  if (selected.kind === "edge") {
    const liveEdge = model?.edges?.find((e) => e.id === selected.id) || selected;
    
    return (
      <div className="pp-fields">
        <div className="pp-field">
          <label>Relationship Type</label>
          <select
            value={liveEdge.data?.edgeType || "subClassOf"}
            onChange={(e) => selected.setEdgeType?.(e.target.value)}
          >
            {EDGE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pp-field">
          <label>Relationship Label</label>
          <input
            type="text"
            value={liveEdge.label || ""}
            onChange={(e) => selected.setLabel?.(e.target.value)}
          />
        </div>
        <div className="pp-info">
          <span className="pp-badge">Edge</span>
          <span className="pp-id">ID: {selected.id}</span>
        </div>
      </div>
    );
  }

  return null;
}

function ImportExportTab({ model, onImport }) {
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const handleExportTTL = () => {
    if (!model) return;

    const lines = [
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
      "@prefix ex: <http://example.org/ontology#> .",
      "",
    ];

    const nodeMap = {};
    for (const n of model.nodes || []) {
      const iri = n.data?.iri || `ex:${(n.data?.label || n.id).replace(/\s+/g, "")}`;
      nodeMap[n.id] = iri;

      const typeMap = {
        classNode: "owl:Class",
        propertyNode:
          n.data?.propertyType === "datatype"
            ? "owl:DatatypeProperty"
            : "owl:ObjectProperty",
        instanceNode: "owl:NamedIndividual",
        literalNode: "rdfs:Literal",
      };

      const rdfType = typeMap[n.type] || "owl:Thing";
      lines.push(`${iri} a ${rdfType} .`);
      if (n.data?.label) {
        lines.push(`${iri} rdfs:label "${n.data.label}" .`);
      }
      if (n.data?.description) {
        lines.push(`${iri} rdfs:comment "${n.data.description}" .`);
      }
      lines.push("");
    }

    for (const e of model.edges || []) {
      const srcIri = nodeMap[e.source];
      const tgtIri = nodeMap[e.target];
      if (!srcIri || !tgtIri) continue;

      const predMap = {
        subClassOf: "rdfs:subClassOf",
        domain: "rdfs:domain",
        range: "rdfs:range",
        rdfType: "rdf:type",
      };
      const pred = predMap[e.data?.edgeType] || e.label || "rdfs:subClassOf";
      lines.push(`${srcIri} ${pred} ${tgtIri} .`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/turtle" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ontology_canvas.ttl";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e) => {
    setImportError(null);
    setShowTechnical(false);
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem("token");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const API = import.meta.env.VITE_API_URL;
      const resp = await fetch(`${API}/canvas/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        const d = detail.detail;
        if (d && typeof d === "object" && d.summary) {
          throw { summary: d.summary, technical: d.technical || "" };
        }
        throw { summary: (typeof d === "string" ? d : null) || "Import failed", technical: "" };
      }
      const data = await resp.json();
      onImport?.(data);
    } catch (err) {
      if (err.summary) {
        setImportError(err);
      } else {
        setImportError({ summary: err.message || "Import failed", technical: "" });
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="pp-io">
      <div className="pp-io-section">
        <h4>Import Ontology</h4>
        <p className="pp-io-desc">Load a Turtle (.ttl) or RDF file onto the canvas.</p>
        <input
          type="file"
          ref={fileInputRef}
          accept=".ttl,.rdf,.owl,.nt,.n3"
          onChange={handleImportFile}
          style={{ display: "none" }}
        />
        <button className="pp-btn" onClick={() => fileInputRef.current?.click()} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Choose File
        </button>
        {importError && (
          <div className="pp-error">
            <div className="pp-error-summary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{importError.summary}</span>
            </div>
            {importError.technical && (
              <>
                <button
                  type="button"
                  className="pp-error-toggle"
                  onClick={() => setShowTechnical(!showTechnical)}
                >
                  {showTechnical ? "Hide" : "Show"} technical details
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showTechnical ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showTechnical && (
                  <pre className="pp-error-details">{importError.technical}</pre>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="pp-io-section">
        <h4>Export as Turtle</h4>
        <p className="pp-io-desc">Download the current canvas as a .ttl file.</p>
        <button className="pp-btn primary" onClick={handleExportTTL} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export .ttl
        </button>
      </div>
    </div>
  );
}

export default function PropertyPanel({ selected, model, onImport }) {
  const [tab, setTab] = useState("element");

  return (
    <aside className="property-panel">
      <div className="pp-tabs">
        <button
          className={`pp-tab ${tab === "element" ? "active" : ""}`}
          onClick={() => setTab("element")}
          type="button"
        >
          Element
        </button>
        <button
          className={`pp-tab ${tab === "io" ? "active" : ""}`}
          onClick={() => setTab("io")}
          type="button"
        >
          Import / Export
        </button>
      </div>

      <div className="pp-body">
        {tab === "element" && <ElementTab selected={selected} model={model} />}
        {tab === "io" && <ImportExportTab model={model} onImport={onImport} />}
      </div>
    </aside>
  );
}
