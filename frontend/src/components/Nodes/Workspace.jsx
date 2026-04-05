import React, { useEffect, useState, useMemo, useRef, useCallback, Fragment } from "react";
import axios from "axios";
import CytoscapeComponent from "react-cytoscapejs";
import "./Workspace.css";
import {
  camelToTitleCase,
  getPredicateDisplay,
  getLocalName,
} from "../../utils/labelUtils";
import SimpleChart from "../Common/SimpleChart";

const API = import.meta.env.VITE_API_URL;
const CMP_NS = import.meta.env.VITE_CMP_NS || "https://tucid/cpmo/";

// ---------- helpers ----------
const local = (iri = "") => getLocalName(iri);

function hashToIndex(str, modulo) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return Math.abs(h) % modulo;
}

const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#22c55e",
  "#ef4444",
  "#e11d48",
  "#06b6d4",
];

const getNodeIri = (n) => {
  if (!n) return "";
  if (typeof n === "string") return n;
  return n.iri || n.id || n.value || "";
};

const isWorkspaceGroupIri = (iri = "") => {
  const base = `${CMP_NS.replace(/\/$/, "")}/instance/group/`;
  return iri.startsWith(base);
};

const displayLabel = (iri) => camelToTitleCase(local(iri));
const displayPredicate = (iri) => {
  const pred = getPredicateDisplay(iri);
  return pred.symbol ? `${pred.symbol} ${pred.name}` : pred.readable;
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

// ---------- FileDropZone component ----------
const FileDropZone = ({ label, accept, file, onFileSelect, onClear, id }) => {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) onFileSelect(dropped);
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  if (file) {
    return (
      <div className="file-chip">
        <div className="file-chip-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className="file-chip-info">
          <span className="file-chip-name">{file.name}</span>
          <span className="file-chip-size">{formatFileSize(file.size)}</span>
        </div>
        <button type="button" className="file-chip-remove" onClick={onClear} title="Remove file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`file-drop-zone${dragOver ? " drag-over" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => {
          if (e.target.files[0]) onFileSelect(e.target.files[0]);
        }}
        style={{ display: "none" }}
        id={id}
      />
      <div className="file-drop-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p className="file-drop-text">
        <span className="file-drop-cta">Click to browse</span> or drag & drop
      </p>
      <p className="file-drop-hint">{label}</p>
    </div>
  );
};

// ---------- component ----------
const Workspace = () => {
  const [initStatus, setInitStatus] = useState("idle");
  const [initError, setInitError] = useState("");

  // search
  const [q, setQ] = useState("");
  const [view, setView] = useState("graph");
  const [level, setLevel] = useState("schema");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  // details
  const [selectedNodeIri, setSelectedNodeIri] = useState("");
  const [details, setDetails] = useState(null);
  const [detailsErr, setDetailsErr] = useState("");

  // upload modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState("single");
  const [schemaName, setSchemaName] = useState("");
  const [schemaFile, setSchemaFile] = useState(null);
  const [instanceFile, setInstanceFile] = useState(null);
  const [schemaUploadLoading, setSchemaUploadLoading] = useState(false);
  const [schemaUploadErr, setSchemaUploadErr] = useState("");
  const [schemaUploadOk, setSchemaUploadOk] = useState("");

  // schemas list & selector
  const [schemas, setSchemas] = useState([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [activeSchemaId, setActiveSchemaId] = useState("");
  const [schemaSelectorOpen, setSchemaSelectorOpen] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const selectorRef = useRef(null);

  const token = localStorage.getItem("token");
  const instanceNsPrefix = `${CMP_NS}instance/`;

  // ---------- fetch user schemas ----------
  const fetchSchemas = useCallback(async () => {
    if (!token) return;
    setSchemasLoading(true);
    try {
      const res = await axios.get(`${API}/workspace/schemas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = (res.data?.schemas || []).filter(s => s.upload_mode !== "base");
      setSchemas(list);
    } catch (e) {
      console.error("Failed to fetch schemas", e);
    } finally {
      setSchemasLoading(false);
    }
  }, [token]);

  // ---------- close selector on outside click ----------
  useEffect(() => {
    const handleClick = (e) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target)) {
        setSchemaSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Filtered schemas for search
  const filteredSchemas = useMemo(() => {
    if (!schemaSearch.trim()) return schemas;
    const term = schemaSearch.toLowerCase();
    return schemas.filter(s => s.name?.toLowerCase().includes(term));
  }, [schemas, schemaSearch]);

  // ---------- init workspace ----------
  useEffect(() => {
    const init = async () => {
      if (!token) {
        setInitStatus("error");
        setInitError("You must be logged in to use the workspace.");
        return;
      }
      setInitStatus("loading");
      try {
        await axios.post(
          `${API}/workspace/init`,
          {},
          {
            params: { schema_id: "main" },
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setInitStatus("ready");
        fetchSchemas();
      } catch (e) {
        console.error("Workspace init failed", e);
        const msg =
          e?.response?.data?.detail ||
          e?.response?.data?.message ||
          "Failed to initialize workspace";
        setInitError(msg);
        setInitStatus("error");
      }
    };
    init();
  }, [token, fetchSchemas]);

  // ---------- label map ----------
  const labelMap = useMemo(() => {
    const m = new Map();
    if (data?.nodes && Array.isArray(data.nodes)) {
      for (const n of data.nodes) {
        const iri = getNodeIri(n);
        const lbl = typeof n === "object" ? n.label : "";
        if (iri) m.set(iri, lbl || "");
      }
    }
    return m;
  }, [data]);

  // ---------- details loader ----------
  const loadDetails = async (iri) => {
    if (!token || !iri) return;
    setDetailsErr("");
    setDetails(null);

    try {
      if (isWorkspaceGroupIri(iri)) {
        const res = await axios.get(`${API}/workspace/neighbors`, {
          params: { schema_id: activeSchemaId, q: iri, limit: 5000, level: "both" },
          headers: { Authorization: `Bearer ${token}` },
        });
        const node =
          (res.data?.nodes || []).find((n) => (n?.iri || n?.id) === iri) ||
          null;
        setDetails(node);
      } else {
        const res = await axios.get(`${API}/instance/details`, {
          params: { iri },
          headers: { Authorization: `Bearer ${token}` },
        });
        setDetails(res.data);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Failed to load details.";
      setDetailsErr(msg);
    }
  };

  // ---------- search ----------
  const doSearch = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    if (!token) {
      setErr("You must be logged in to query your workspace.");
      return;
    }
    if (!activeSchemaId) {
      setErr("Please select an ontology first.");
      return;
    }

    setErr("");
    setLoading(true);
    setData(null);
    setSelectedNodeIri("");
    setDetails(null);
    setDetailsErr("");

    try {
      const res = await axios.get(`${API}/workspace/neighbors`, {
        params: { schema_id: activeSchemaId, q, limit: 5000, level },
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch (e) {
      console.error("Workspace search error", e);
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e.message ||
        "Error while searching workspace.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  // ---------- upload custom schema ----------
  const handleUploadSchema = async (e) => {
    e.preventDefault();

    if (!token) {
      setSchemaUploadErr("You must be logged in to upload schemas.");
      return;
    }
    if (!schemaName.trim()) {
      setSchemaUploadErr("Ontology name is required.");
      return;
    }
    if (!schemaFile) {
      setSchemaUploadErr(
        uploadMode === "single"
          ? "Ontology file is required."
          : "Schema file is required."
      );
      return;
    }
    if (uploadMode === "separate" && !instanceFile) {
      setSchemaUploadErr("Instance file is required.");
      return;
    }

    setSchemaUploadErr("");
    setSchemaUploadOk("");
    setSchemaUploadLoading(true);

    try {
      const form = new FormData();
      form.append("name", schemaName.trim());
      form.append("mode", uploadMode === "single" ? "combined" : "separate");
      form.append("schema_file", schemaFile);

      if (uploadMode === "separate" && instanceFile) {
        form.append("instances_file", instanceFile);
      }

      const res = await axios.post(`${API}/workspace/schema/upload`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setSchemaUploadOk("Ontology uploaded successfully!");
      setSchemaName("");
      setSchemaFile(null);
      setInstanceFile(null);

      // Refresh schemas list and auto-select the new one
      await fetchSchemas();
      const newSchemaId = res.data?.schema?.schema_id;
      if (newSchemaId) {
        setActiveSchemaId(newSchemaId);
      }

      setTimeout(() => {
        setUploadModalOpen(false);
        setSchemaUploadOk("");
      }, 1200);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to upload ontology.";
      setSchemaUploadErr(msg);
    } finally {
      setSchemaUploadLoading(false);
    }
  };

  const closeUploadModal = () => {
    if (schemaUploadLoading) return;
    setUploadModalOpen(false);
    setSchemaUploadErr("");
    setSchemaUploadOk("");
    setSchemaName("");
    setSchemaFile(null);
    setInstanceFile(null);
    setUploadMode("single");
  };

  // ---------- graph ----------
  const cyElements = useMemo(() => {
    if (!data) return [];

    const nodes = new Map();

    const pushNode = (id, isCenter = false) => {
      if (!id || nodes.has(id)) return;
      const label = labelMap.get(id) || displayLabel(id);
      const color = isCenter
        ? "#2563eb"
        : PALETTE[hashToIndex(id, PALETTE.length)];

      nodes.set(id, {
        data: { id, label, color, isCenter: String(!!isCenter) },
      });
    };

    if (data.node) pushNode(data.node, true);

    if (Array.isArray(data.nodes)) {
      for (const n of data.nodes) {
        const nid = getNodeIri(n);
        pushNode(nid);
      }
    }

    const edges = [];
    for (const e of data.edges || []) {
      const source = e.source || e.s || e.from;
      const target = e.target || e.t || e.to;
      const relation = e.relation || e.p || e.pred || e.label;
      const id = `${source}->${relation}->${target}`;

      pushNode(source);
      pushNode(target);

      edges.push({
        data: { id, source, target, label: displayPredicate(relation) },
      });
    }

    return [...nodes.values(), ...edges];
  }, [data, labelMap]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          label: "data(label)",
          color: "#111827",
          "font-size": 6,
          "text-wrap": "wrap",
          "text-max-width": 60,
          "text-valign": "center",
          "text-halign": "center",
          width: 24,
          height: 24,
          "border-width": 0,
        },
      },
      {
        selector: 'node[isCenter = "true"]',
        style: {
          width: 32,
          height: 32,
          "font-weight": 700,
          color: "#0f172a",
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#94a3b8",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          label: "data(label)",
          "font-size": 5,
          color: "#475569",
          "curve-style": "bezier",
        },
      },
      {
        selector: ":selected",
        style: {
          "border-width": 3,
          "border-color": "#7c3aed",
          "line-color": "#7c3aed",
          "target-arrow-color": "#7c3aed",
        },
      },
    ],
    []
  );

  // active schema label for display
  const activeSchemaLabel = useMemo(() => {
    if (!activeSchemaId) return "";
    const found = schemas.find((s) => s.schema_id === activeSchemaId);
    return found ? found.name : activeSchemaId;
  }, [activeSchemaId, schemas]);

  // ---------- render ----------
  if (initStatus === "loading") {
    return (
      <div className="workspace-container">
        <div className="workspace-card">
          <div className="workspace-loading">
            <div className="loading-spinner"></div>
            <p>Preparing your workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  if (initStatus === "error") {
    return (
      <div className="workspace-container">
        <div className="workspace-card">
          <div className="workspace-error">
            <h2>Workspace</h2>
            <div className="error-banner">{initError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-container">
      <div className="workspace-card">
        {/* Header */}
        <div className="workspace-header">
          <div className="workspace-header-left">
            <h2 className="workspace-title">My Workspace</h2>
            <p className="workspace-subtitle">
              Explore and visualize your personal ontology
            </p>
          </div>

          <div className="workspace-header-actions">
            <button
              className="workspace-btn-primary"
              onClick={() => setUploadModalOpen(true)}
              type="button"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Ontology
            </button>
          </div>
        </div>

        {/* Search Panel */}
        <div className="workspace-panel">
          {schemas.length === 0 && !schemasLoading && (
            <div className="workspace-empty-prompt">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p>No ontologies uploaded yet. Upload an ontology to start exploring.</p>
            </div>
          )}

          <form className="workspace-search-form" onSubmit={doSearch}>
            {/* Searchable Schema Selector */}
            <div className="schema-combobox" ref={selectorRef}>
              <div
                className={`schema-combobox-trigger${schemaSelectorOpen ? " open" : ""}${!activeSchemaId ? " placeholder" : ""}`}
                onClick={() => setSchemaSelectorOpen(!schemaSelectorOpen)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSchemaSelectorOpen(!schemaSelectorOpen); } }}
              >
                <span className="schema-combobox-value">
                  {activeSchemaId ? activeSchemaLabel : "Select an ontology..."}
                </span>
                <svg className={`schema-combobox-chevron${schemaSelectorOpen ? " rotated" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>

              {schemaSelectorOpen && (
                <div className="schema-combobox-dropdown">
                  <div className="schema-combobox-search-wrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      className="schema-combobox-search"
                      placeholder="Search ontologies..."
                      value={schemaSearch}
                      onChange={(e) => setSchemaSearch(e.target.value)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  <div className="schema-combobox-list">
                    {filteredSchemas.length === 0 && (
                      <div className="schema-combobox-empty">No ontologies found</div>
                    )}
                    {filteredSchemas.map((s) => (
                      <div
                        key={s.schema_id}
                        className={`schema-combobox-item${activeSchemaId === s.schema_id ? " selected" : ""}`}
                        onClick={() => {
                          setActiveSchemaId(s.schema_id);
                          setSchemaSelectorOpen(false);
                          setSchemaSearch("");
                          setData(null);
                          setErr("");
                        }}
                      >
                        <span className="schema-combobox-item-name">{s.name}</span>
                        {s.upload_mode === "separate" && (
                          <span className="schema-combobox-item-badge">Schema + Instance</span>
                        )}
                        {activeSchemaId === s.schema_id && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <input
              className="workspace-input"
              placeholder="Search for a class or term..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="workspace-select"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="schema">Schema only</option>
              <option value="both">Schema + Data</option>
            </select>
            <button
              className="workspace-btn-primary"
              type="submit"
              disabled={loading || !activeSchemaId}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </form>

          {activeSchemaId && (
            <div className="active-schema-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Searching in: <strong>{activeSchemaLabel}</strong>
            </div>
          )}

          {data && (
            <div className="workspace-view-toggle">
              <button
                className={`view-btn ${view === "graph" ? "active" : ""}`}
                onClick={() => setView("graph")}
                type="button"
              >
                Graph
              </button>
              <button
                className={`view-btn ${view === "list" ? "active" : ""}`}
                onClick={() => setView("list")}
                type="button"
              >
                List
              </button>
            </div>
          )}

          {loading && (
            <div className="workspace-loading-inline">
              <div className="loading-spinner small"></div>
              <span>Searching...</span>
            </div>
          )}

          {err && <div className="error-banner">{err}</div>}

          {data && (
            <div className="workspace-results">
              <div className="results-meta">
                <span className="results-badge">
                  Center: {displayLabel(data.node)}
                </span>
                <span className="results-count">
                  {data.nodes?.length || 0} nodes • {data.edges?.length || 0} edges
                </span>
              </div>

              {view === "graph" && cyElements.length > 0 && (
                <div className="workspace-graph">
                  <CytoscapeComponent
                    elements={cyElements}
                    layout={{
                      name: "cose",
                      animate: "end",
                      fit: true,
                      padding: 40,
                    }}
                    stylesheet={stylesheet}
                    style={{ width: "100%", height: "450px" }}
                    wheelSensitivity={0.2}
                    cy={(cy) => {
                      cy.off("tap");
                      cy.on("tap", "node", (evt) => {
                        const iri = evt.target.id();
                        if (
                          iri &&
                          (isWorkspaceGroupIri(iri) ||
                            iri.startsWith(instanceNsPrefix))
                        ) {
                          setSelectedNodeIri(iri);
                          loadDetails(iri);
                        }
                      });
                    }}
                  />
                </div>
              )}

              {view === "list" && (
                <div className="workspace-list">
                  {data.edges?.map((e, i) => {
                    const source = e.source || e.s || e.from;
                    const target = e.target || e.t || e.to;
                    const relation = e.relation || e.p || e.pred || e.label;

                    return (
                      <div className="edge-item" key={i}>
                        <span className="edge-source">{displayLabel(source)}</span>
                        <span className="edge-relation">
                          {displayPredicate(relation)}
                        </span>
                        <span className="edge-target">{displayLabel(target)}</span>
                      </div>
                    );
                  })}

                  {(!data.edges || data.edges.length === 0) && (
                    <div className="empty-state">No connections found.</div>
                  )}
                </div>
              )}

              {selectedNodeIri && details && (
                <div className="workspace-details">
                  <h4>{displayLabel(selectedNodeIri)}</h4>

                  {details.values && details.values.length > 0 && (
                    <>
                      {(() => {
                        const vals = details.values
                          .map(Number)
                          .filter(Number.isFinite);

                        if (vals.length > 1) {
                          return (
                            <SimpleChart
                              data={vals.slice(0, 100)}
                              title="Value Distribution"
                              height={160}
                            />
                          );
                        }
                        return null;
                      })()}

                      <div className="details-stats">
                        <div>
                          <strong>Count:</strong>{" "}
                          {details.summary?.count || details.values.length}
                        </div>
                        <div>
                          <strong>Min:</strong> {details.summary?.min ?? "N/A"}
                        </div>
                        <div>
                          <strong>Max:</strong> {details.summary?.max ?? "N/A"}
                        </div>
                        <div>
                          <strong>Avg:</strong> {details.summary?.avg ?? "N/A"}
                        </div>
                      </div>
                    </>
                  )}

                  {detailsErr && <div className="error-banner">{detailsErr}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upload Popup Modal */}
      {uploadModalOpen && (
        <div className="workspace-modal-overlay" onClick={closeUploadModal}>
          <div
            className="workspace-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="workspace-modal-header">
              <div className="workspace-modal-title-group">
                <div className="workspace-modal-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <h3>Upload Ontology</h3>
                  <p className="workspace-modal-desc">Import RDF files into your workspace</p>
                </div>
              </div>
              <button
                type="button"
                className="workspace-modal-close"
                onClick={closeUploadModal}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUploadSchema} className="workspace-modal-body">
              <div className="edit-section">
                <label className="edit-label">Ontology Name *</label>
                <input
                  className="workspace-input"
                  placeholder="e.g., Supply Chain Ontology"
                  value={schemaName}
                  onChange={(e) => setSchemaName(e.target.value)}
                />
              </div>

              <div className="edit-section">
                <label className="edit-label">Upload Type</label>
                <div className="upload-mode-toggle">
                  <button
                    type="button"
                    className={`upload-mode-btn ${uploadMode === "single" ? "active" : ""}`}
                    onClick={() => {
                      setUploadMode("single");
                      setSchemaFile(null);
                      setInstanceFile(null);
                      setSchemaUploadErr("");
                      setSchemaUploadOk("");
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Single File
                  </button>
                  <button
                    type="button"
                    className={`upload-mode-btn ${uploadMode === "separate" ? "active" : ""}`}
                    onClick={() => {
                      setUploadMode("separate");
                      setSchemaFile(null);
                      setInstanceFile(null);
                      setSchemaUploadErr("");
                      setSchemaUploadOk("");
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                    Schema + Instance
                  </button>
                </div>
              </div>

              {uploadMode === "single" ? (
                <div className="edit-section">
                  <label className="edit-label">Ontology File *</label>
                  <FileDropZone
                    id="ontology-file"
                    label=".ttl, .rdf, .n3, .owl, .jsonld"
                    accept=".ttl,.rdf,.n3,.owl,.jsonld"
                    file={schemaFile}
                    onFileSelect={setSchemaFile}
                    onClear={() => setSchemaFile(null)}
                  />
                </div>
              ) : (
                <>
                  <div className="edit-section">
                    <label className="edit-label">Schema File *</label>
                    <FileDropZone
                      id="schema-file"
                      label=".ttl, .rdf, .n3, .owl, .jsonld"
                      accept=".ttl,.rdf,.n3,.owl,.jsonld"
                      file={schemaFile}
                      onFileSelect={setSchemaFile}
                      onClear={() => setSchemaFile(null)}
                    />
                  </div>

                  <div className="edit-section">
                    <label className="edit-label">Instance File *</label>
                    <FileDropZone
                      id="instance-file"
                      label=".ttl, .rdf, .n3, .owl, .jsonld"
                      accept=".ttl,.rdf,.n3,.owl,.jsonld"
                      file={instanceFile}
                      onFileSelect={setInstanceFile}
                      onClear={() => setInstanceFile(null)}
                    />
                  </div>
                </>
              )}

              {schemaUploadErr && (
                <div className="error-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {schemaUploadErr}
                </div>
              )}
              {schemaUploadOk && (
                <div className="success-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  {schemaUploadOk}
                </div>
              )}

              <div className="upload-actions">
                <button
                  type="button"
                  className="workspace-btn-secondary"
                  onClick={closeUploadModal}
                >
                  Cancel
                </button>
                <button
                  className="workspace-btn-primary"
                  type="submit"
                  disabled={
                    schemaUploadLoading ||
                    !schemaName.trim() ||
                    !schemaFile ||
                    (uploadMode === "separate" && !instanceFile)
                  }
                >
                  {schemaUploadLoading ? (
                    <>
                      <div className="loading-spinner small"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Upload
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workspace;