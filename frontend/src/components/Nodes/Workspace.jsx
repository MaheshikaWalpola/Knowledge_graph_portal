import React, { useEffect, useState, useMemo } from "react";
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

const makeLocalName = (label = "") => {
  const cleaned = label.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
};

const makeSchemaIri = (label = "") => `${CMP_NS}${makeLocalName(label)}`;

// map simple predicate text → well-known IRIs
const PREDICATE_MAP = {
  subclassof: "http://www.w3.org/2000/01/rdf-schema#subClassOf",
  "rdfs:subclassof": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
  "rdfs-subclassof": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
  hasinputparameter: `${CMP_NS}hasInputParameter`,
  hasoutputparameter: `${CMP_NS}hasOutputParameter`,
};

const toSchemaIri = (value) => {
  const v = value.trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return makeSchemaIri(v);
};

const toPredicateIri = (value) => {
  const v = value.trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  const key = v.toLowerCase().replace(/\s+/g, "");
  if (PREDICATE_MAP[key]) return PREDICATE_MAP[key];
  return makeSchemaIri(v);
};

const getNodeIri = (n) => {
  if (!n) return "";
  if (typeof n === "string") return n;
  return n.iri || n.id || n.value || "";
};

const isWorkspaceGroupIri = (iri = "") => {
  const base = `${CMP_NS.replace(/\/$/, "")}/instance/group/`;
  return iri.startsWith(base);
};

// Format display with CamelCase conversion
const displayLabel = (iri) => camelToTitleCase(local(iri));
const displayPredicate = (iri) => {
  const pred = getPredicateDisplay(iri);
  return pred.symbol ? `${pred.symbol} ${pred.name}` : pred.readable;
};

// ---------- component ----------
const Workspace = () => {
  // workspace init
  const [initStatus, setInitStatus] = useState("idle");
  const [initError, setInitError] = useState("");
  const groupPrefix = `${CMP_NS}instance/group/`;

  // Active tab for actions
  const [activeTab, setActiveTab] = useState("search"); // search | edit | upload

  // which workspace schema is active
  const [schemaId, setSchemaId] = useState("main");

  // search
  const [q, setQ] = useState("");
  const [view, setView] = useState("graph"); // list | graph
  const [level, setLevel] = useState("schema");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  // instance/group details panel
  const [selectedNodeIri, setSelectedNodeIri] = useState("");
  const [details, setDetails] = useState(null);
  const [detailsErr, setDetailsErr] = useState("");

  // edit mode
  const [editMode, setEditMode] = useState("add"); // add | delete | replace
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");

  // Triple fields
  const [subject, setSubject] = useState("");
  const [predicate, setPredicate] = useState("");
  const [object, setObject] = useState("");
  const [oldSubject, setOldSubject] = useState("");
  const [oldPredicate, setOldPredicate] = useState("");
  const [oldObject, setOldObject] = useState("");

  // Instance upload
  const [csvFiles, setCsvFiles] = useState([]);
  const [instUploadLoading, setInstUploadLoading] = useState(false);
  const [instUploadErr, setInstUploadErr] = useState("");
  const [instUploadOk, setInstUploadOk] = useState("");

  const token = localStorage.getItem("token");

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
            params: { schema_id: schemaId },
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        setInitStatus("ready");
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
  }, [token, schemaId]);

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
          params: { schema_id: schemaId, q: iri, limit: 5000, level: "both" },
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

    setErr("");
    setLoading(true);
    setData(null);
    setSelectedNodeIri("");
    setDetails(null);
    setDetailsErr("");

    try {
      const res = await axios.get(`${API}/workspace/neighbors`, {
        params: { schema_id: schemaId, q, limit: 5000, level },
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

  // ---------- download ----------
  const handleDownload = async () => {
    if (!token) {
      setErr("You must be logged in to download your workspace.");
      return;
    }
    try {
      const res = await axios.get(`${API}/workspace/export`, {
        params: { schema_id: schemaId },
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "text/turtle" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `workspace_schema_${schemaId}.ttl`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download error", e);
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Failed to download workspace schema.";
      setErr(msg);
    }
  };

  // ---------- upload csvs ----------
  const handleUploadCsvs = async () => {
    if (!token) {
      setInstUploadErr("You must be logged in to upload CSV files.");
      return;
    }
    if (!csvFiles || csvFiles.length === 0) {
      setInstUploadErr("Please select one or more CSV files.");
      return;
    }

    setInstUploadErr("");
    setInstUploadOk("");
    setInstUploadLoading(true);

    try {
      const form = new FormData();
      for (const f of csvFiles) form.append("files", f);

      const res = await axios.post(`${API}/workspace/instances/upload`, form, {
        params: { schema_id: schemaId },
        headers: { Authorization: `Bearer ${token}` },
      });

      const ttl = res.data?.turtle || "";
      if (ttl) {
        const blob = new Blob([ttl], { type: "text/turtle" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `workspace_instances_${schemaId}.ttl`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }

      setInstUploadOk(
        `Uploaded ${res.data?.triples ?? "?"} triples successfully.`,
      );
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Failed to upload CSVs / generate instances.";
      setInstUploadErr(msg);
    } finally {
      setInstUploadLoading(false);
    }
  };

  const instanceNsPrefix = `${CMP_NS}instance/`;

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
    [],
  );

  // ---------- apply edits ----------
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setEditError("You must be logged in to edit your workspace.");
      return;
    }

    setEditError("");
    setEditSuccess("");
    setEditLoading(true);

    try {
      if (editMode === "add") {
        const sIri = toSchemaIri(subject);
        const pIri = toPredicateIri(predicate);
        const oIri = toSchemaIri(object);

        if (!sIri || !pIri || !oIri) {
          setEditError("Subject, predicate, and object are required.");
          setEditLoading(false);
          return;
        }

        const res = await axios.post(
          `${API}/workspace/triple/add`,
          { subject: sIri, predicate: pIri, object: oIri },
          {
            params: { schema_id: schemaId },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        setEditSuccess("Triple added successfully.");
        if (res.data && res.data.neighbors) setData(res.data.neighbors);
        setSubject("");
        setPredicate("");
        setObject("");
      } else if (editMode === "delete") {
        const sIri = toSchemaIri(subject);
        const pIri = toPredicateIri(predicate);

        if (!sIri || !pIri) {
          setEditError("Subject and predicate are required.");
          setEditLoading(false);
          return;
        }

        const payload = { subject: sIri, predicate: pIri };
        const oIri = object.trim() ? toSchemaIri(object) : "";
        if (oIri) payload.object = oIri;

        const res = await axios.post(
          `${API}/workspace/triple/delete`,
          payload,
          {
            params: { schema_id: schemaId },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        setEditSuccess("Triple(s) deleted successfully.");
        if (res.data && res.data.neighbors) setData(res.data.neighbors);
        setSubject("");
        setPredicate("");
        setObject("");
      } else if (editMode === "replace") {
        const oldSIri = toSchemaIri(oldSubject);
        const oldPIri = toPredicateIri(oldPredicate);
        const oldOIri = toSchemaIri(oldObject);
        const newSIri = toSchemaIri(subject);
        const newPIri = toPredicateIri(predicate);
        const newOIri = toSchemaIri(object);

        if (
          !oldSIri ||
          !oldPIri ||
          !oldOIri ||
          !newSIri ||
          !newPIri ||
          !newOIri
        ) {
          setEditError("All fields are required for replace.");
          setEditLoading(false);
          return;
        }

        await axios.post(
          `${API}/workspace/triple/delete`,
          { subject: oldSIri, predicate: oldPIri, object: oldOIri },
          {
            params: { schema_id: schemaId },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        const res = await axios.post(
          `${API}/workspace/triple/add`,
          { subject: newSIri, predicate: newPIri, object: newOIri },
          {
            params: { schema_id: schemaId },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        setEditSuccess("Triple replaced successfully.");
        if (res.data && res.data.neighbors) setData(res.data.neighbors);
        setOldSubject("");
        setOldPredicate("");
        setOldObject("");
        setSubject("");
        setPredicate("");
        setObject("");
      }
    } catch (e) {
      console.error("Workspace edit error", e);
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Failed to apply change to workspace.";
      setEditError(msg);
    } finally {
      setEditLoading(false);
    }
  };

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
              Build and explore your personal ontology
            </p>
          </div>

          <div className="workspace-header-actions">
            <select
              className="workspace-select"
              value={schemaId}
              onChange={(e) => {
                setSchemaId(e.target.value);
                setData(null);
                setErr("");
                setSelectedNodeIri("");
                setDetails(null);
              }}
              title="Select workspace schema"
            >
              <option value="main">Main Schema</option>
              <option value="schema1">Schema 1</option>
              <option value="schema2">Schema 2</option>
            </select>

            <button
              className="workspace-btn-secondary"
              onClick={handleDownload}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="workspace-tabs">
          <button
            className={`workspace-tab ${activeTab === "search" ? "active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Search
          </button>
          <button
            className={`workspace-tab ${activeTab === "edit" ? "active" : ""}`}
            onClick={() => setActiveTab("edit")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Triples
          </button>
          <button
            className={`workspace-tab ${activeTab === "upload" ? "active" : ""}`}
            onClick={() => setActiveTab("upload")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload CSV
          </button>
        </div>

        {/* Search Panel */}
        {activeTab === "search" && (
          <div className="workspace-panel">
            <form className="workspace-search-form" onSubmit={doSearch}>
              <input
                className="workspace-input"
                placeholder="Search for a term (e.g., Pressure, Velocity)"
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
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </form>

            {/* View toggle */}
            {data && (
              <div className="workspace-view-toggle">
                <button
                  className={`view-btn ${view === "graph" ? "active" : ""}`}
                  onClick={() => setView("graph")}
                >
                  Graph
                </button>
                <button
                  className={`view-btn ${view === "list" ? "active" : ""}`}
                  onClick={() => setView("list")}
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
                    {data.nodes?.length || 0} nodes • {data.edges?.length || 0}{" "}
                    edges
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
                          <span className="edge-source">
                            {displayLabel(source)}
                          </span>
                          <span className="edge-relation">
                            {displayPredicate(relation)}
                          </span>
                          <span className="edge-target">
                            {displayLabel(target)}
                          </span>
                        </div>
                      );
                    })}
                    {(!data.edges || data.edges.length === 0) && (
                      <div className="empty-state">No connections found.</div>
                    )}
                  </div>
                )}

                {/* Details panel */}
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
                            <strong>Min:</strong>{" "}
                            {details.summary?.min ?? "N/A"}
                          </div>
                          <div>
                            <strong>Max:</strong>{" "}
                            {details.summary?.max ?? "N/A"}
                          </div>
                          <div>
                            <strong>Avg:</strong>{" "}
                            {details.summary?.avg ?? "N/A"}
                          </div>
                        </div>
                      </>
                    )}
                    {detailsErr && (
                      <div className="error-banner">{detailsErr}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Edit Panel */}
        {activeTab === "edit" && (
          <div className="workspace-panel">
            <div className="edit-mode-toggle">
              <button
                className={`edit-mode-btn ${editMode === "add" ? "active" : ""}`}
                onClick={() => {
                  setEditMode("add");
                  setEditError("");
                  setEditSuccess("");
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
              </button>
              <button
                className={`edit-mode-btn ${editMode === "delete" ? "active" : ""}`}
                onClick={() => {
                  setEditMode("delete");
                  setEditError("");
                  setEditSuccess("");
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Delete
              </button>
              <button
                className={`edit-mode-btn ${editMode === "replace" ? "active" : ""}`}
                onClick={() => {
                  setEditMode("replace");
                  setEditError("");
                  setEditSuccess("");
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                Update
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="edit-form">
              {editMode === "replace" && (
                <div className="edit-section">
                  <label className="edit-label">Old Triple (to remove)</label>
                  <div className="edit-triple-row">
                    <input
                      className="workspace-input"
                      placeholder="Subject"
                      value={oldSubject}
                      onChange={(e) => setOldSubject(e.target.value)}
                    />
                    <input
                      className="workspace-input"
                      placeholder="Predicate"
                      value={oldPredicate}
                      onChange={(e) => setOldPredicate(e.target.value)}
                    />
                    <input
                      className="workspace-input"
                      placeholder="Object"
                      value={oldObject}
                      onChange={(e) => setOldObject(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="edit-section">
                <label className="edit-label">
                  {editMode === "replace"
                    ? "New Triple"
                    : editMode === "add"
                      ? "Add Triple"
                      : "Delete Triple"}
                </label>
                <div className="edit-triple-row">
                  <input
                    className="workspace-input"
                    placeholder="Subject (e.g., HeadSpeed)"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                  <input
                    className="workspace-input"
                    placeholder="Predicate (e.g., subClassOf)"
                    value={predicate}
                    onChange={(e) => setPredicate(e.target.value)}
                  />
                  <input
                    className="workspace-input"
                    placeholder={
                      editMode === "delete"
                        ? "Object (optional)"
                        : "Object (e.g., Velocity)"
                    }
                    value={object}
                    onChange={(e) => setObject(e.target.value)}
                  />
                </div>
              </div>

              {editError && <div className="error-banner">{editError}</div>}
              {editSuccess && (
                <div className="success-banner">{editSuccess}</div>
              )}

              <button
                className="workspace-btn-primary"
                type="submit"
                disabled={editLoading}
              >
                {editLoading
                  ? "Saving..."
                  : `Apply ${editMode === "add" ? "Add" : editMode === "delete" ? "Delete" : "Update"}`}
              </button>
            </form>
          </div>
        )}

        {/* Upload Panel */}
        {activeTab === "upload" && (
          <div className="workspace-panel">
            <div className="upload-section">
              <p className="upload-description">
                Upload CSV files to generate instance data for your workspace
                schema.
              </p>

              <div className="upload-area">
                <input
                  type="file"
                  accept=".csv"
                  multiple
                  id="csv-upload"
                  className="upload-input"
                  onChange={(e) => {
                    setCsvFiles(Array.from(e.target.files || []));
                    setInstUploadErr("");
                    setInstUploadOk("");
                  }}
                />
                <label htmlFor="csv-upload" className="upload-label">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17,8 12,3 7,8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {csvFiles.length > 0
                    ? `${csvFiles.length} file(s) selected`
                    : "Click to select CSV files"}
                </label>
              </div>

              {instUploadErr && (
                <div className="error-banner">{instUploadErr}</div>
              )}
              {instUploadOk && (
                <div className="success-banner">{instUploadOk}</div>
              )}

              <button
                className="workspace-btn-primary"
                onClick={handleUploadCsvs}
                disabled={instUploadLoading || csvFiles.length === 0}
              >
                {instUploadLoading ? "Uploading..." : "Generate Instances"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
