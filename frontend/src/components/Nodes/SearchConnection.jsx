import { useState, useMemo } from "react";
import axios from "axios";
import CytoscapeComponent from "react-cytoscapejs";
import "./SearchConnection.css";
import {
  camelToTitleCase,
  getPredicateDisplay,
  getLocalName,
  getMeasurementValues,
  strideSample,
} from "../../utils/labelUtils";
import SimpleChart from "../Common/SimpleChart";

const local = (iri = "") => getLocalName(iri);

const API = import.meta.env.VITE_API_URL;

function hashToIndex(str, modulo) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return Math.abs(h) % modulo;
}

// Pastel color palette - soft, pleasant colors
const PALETTE = [
  "#93c5fd", // Pastel Blue
  "#86efac", // Pastel Green
  "#fca5a5", // Pastel Red
  "#c4b5fd", // Pastel Purple
  "#fdba74", // Pastel Orange
  "#67e8f9", // Pastel Cyan
  "#f9a8d4", // Pastel Pink
  "#5eead4", // Pastel Teal
  "#a5b4fc", // Pastel Indigo
  "#fde047", // Pastel Yellow
  "#d8b4fe", // Pastel Violet
  "#bef264", // Pastel Lime
  "#fcd34d", // Pastel Amber
  "#7dd3fc", // Pastel Sky
  "#a3e635", // Pastel Green-Yellow
  "#e879f9", // Pastel Magenta
];

const isInstanceIri = (iri = "") => (iri || "").includes("/instance/");

const humanizeInstanceId = (id = "") => {
  // Pressure_2_MAIN_OUTER_AIR_BAG_PRESSURE -> Main Outer Air Bag Pressure
  const afterPrefix = (id || "").replace(/^[A-Za-z]+_\d+_/, "");
  return afterPrefix
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Convert CamelCase labels to readable format
const displayLabel = (iri = "") => {
  const id = local(iri);
  if (isInstanceIri(iri)) return humanizeInstanceId(id);
  return camelToTitleCase(id);
};

// Get predicate display - just the readable name
const displayPredicate = (iri = "") => {
  const pred = getPredicateDisplay(iri);
  // Return just the name (e.g., "subclass", "input", "type")
  return pred.name || pred.readable || "related";
};

export default function SearchConnection() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("schema"); // schema | both
  const [view, setView] = useState("list"); // list | graph
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  // instance details panel
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [instanceLoading, setInstanceLoading] = useState(false);
  const [instanceErr, setInstanceErr] = useState("");

  const doSearch = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;

    setErr("");
    setData(null);
    setSelectedInstance(null);
    setInstanceErr("");

    setLoading(true);
    try {
      const path =
        mode === "schema" ? "/schema/neighbors" : "/schema/instances/neighbors";
      const res = await axios.get(`${API}${path}`, { params: { q } });
      setData(res.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const loadInstanceDetails = async (instanceIri) => {
    if (!instanceIri) return;

    setInstanceErr("");
    setInstanceLoading(true);
    setSelectedInstance(null);

    try {
      const res = await axios.get(`${API}/instance/details`, {
        params: { iri: instanceIri },
      });
      setSelectedInstance(res.data);
    } catch (e) {
      setInstanceErr(
        e?.response?.data?.detail ||
          e.message ||
          "Failed to load instance details",
      );
    } finally {
      setInstanceLoading(false);
    }
  };

  const cyElements = useMemo(() => {
    if (!data) return [];

    const nodes = new Map();

    const pushNode = (id, isCenter = false) => {
      if (!id || nodes.has(id)) return;

      const label = displayLabel(id);
      const color = isCenter
        ? "#eab308"
        : PALETTE[hashToIndex(id, PALETTE.length)];

      nodes.set(id, {
        data: { id, label, color, isCenter: String(!!isCenter) },
      });
    };

    if (data.node) pushNode(data.node, true);

    if (Array.isArray(data.nodes)) {
      for (const n of data.nodes) {
        const nid = typeof n === "string" ? n : n?.id || n?.iri || n?.value;
        pushNode(nid);
      }
    }

    const edges = [];
    for (const e of data.edges || []) {
      const source = e.source || e.s || e.from;
      const target = e.target || e.t || e.to;
      const relation = e.relation || e.p || e.pred || e.label;

      if (!source || !target || !relation) continue;

      const id = `${source}->${relation}->${target}`;
      pushNode(source);
      pushNode(target);

      edges.push({
        data: { id, source, target, label: displayPredicate(relation) },
      });
    }

    return [...nodes.values(), ...edges];
  }, [data]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "background-opacity": 1,
          label: "data(label)",
          color: "#1e293b",
          "font-size": 9,
          "font-weight": 600,
          "text-wrap": "wrap",
          "text-max-width": 70,
          "text-valign": "center",
          "text-halign": "center",
          width: 32,
          height: 32,
          "border-width": 2,
          "border-color": "#ffffff",
          "border-opacity": 0.8,
          "text-outline-color": "#ffffff",
          "text-outline-width": 1,
        },
      },
      {
        selector: 'node[isCenter = "true"]',
        style: {
          width: 48,
          height: 48,
          "font-size": 11,
          "font-weight": 700,
          "background-color": "#eab308",
          color: "#0f172a",
          "border-width": 3,
          "border-color": "#ffffff",
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#94a3b8",
          "target-arrow-color": "#64748b",
          "target-arrow-shape": "triangle",
          "arrow-scale": 1,
          label: "data(label)",
          "font-size": 10,
          "font-weight": 600,
          color: "#334155",
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.95,
          "text-background-padding": "3px",
          "text-border-opacity": 0,
          "curve-style": "bezier",
        },
      },
      {
        selector: ":selected",
        style: {
          "border-width": 3,
          "border-color": "#1e40af",
          "line-color": "#2563eb",
          "target-arrow-color": "#2563eb",
        },
      },
    ],
    [],
  );

  const renderInstancePanel = () => {
    if (mode !== "both") return null;

    return (
      <div className="instance-panel">
        <h3 className="instance-panel-title">Instance Details</h3>

        {!selectedInstance && !instanceLoading && !instanceErr && (
          <div className="empty-state">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ color: "var(--text-tertiary)", marginBottom: 8 }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <p>
              Click a node in the graph to view instance details and data
              visualization
            </p>
          </div>
        )}

        {instanceLoading && (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span>Loading instance data...</span>
          </div>
        )}

        {instanceErr && <div className="error-banner">{instanceErr}</div>}

        {selectedInstance && (
          <div className="instance-card">
            <div className="instance-header">
              <h4 className="instance-name">
                {humanizeInstanceId(
                  local(selectedInstance.iri || selectedInstance.id),
                )}
              </h4>
              <span className="instance-type-badge">
                {displayLabel(
                  selectedInstance.type || selectedInstance.class || "",
                )}
              </span>
            </div>

            <div className="instance-iri">
              <span className="iri-label">IRI:</span>
              <code>{selectedInstance.iri}</code>
            </div>

            {Array.isArray(selectedInstance.values) &&
            selectedInstance.values.length > 0 ? (
              <>
                {(() => {
                  // Base instance values always come from cmpo:hasNumericValue
                  // which is a guaranteed measurement predicate → backendFlag: true.
                  // For future-proofing, also inspect the instance type label.
                  const measVals = getMeasurementValues(
                    selectedInstance.values,
                    {
                      backendFlag: selectedInstance.is_measurement ?? true,
                      predicateIri: selectedInstance.predicate_iri,
                      label: selectedInstance.type || "",
                    }
                  );

                  if (!measVals) {
                    return (
                      <div className="empty-state small">
                        No measurement data available for charting
                      </div>
                    );
                  }

                  const min = Math.min(...measVals);
                  const max = Math.max(...measVals);
                  const avg = measVals.reduce((a, b) => a + b, 0) / measVals.length;

                  return (
                    <>
                      {/* Stats Summary */}
                      <div className="stats-grid">
                        <div className="stat-card">
                          <span className="stat-label">Min</span>
                          <span className="stat-value">{min.toFixed(2)}</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">Max</span>
                          <span className="stat-value">{max.toFixed(2)}</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">Average</span>
                          <span className="stat-value">{avg.toFixed(3)}</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">Count</span>
                          <span className="stat-value">{measVals.length}</span>
                        </div>
                      </div>

                      {/* Interactive Chart */}
                      {measVals.length > 1 && (() => {
                        const CHART_POINTS = 150;
                        const sampleData = strideSample(measVals, CHART_POINTS);
                        return (
                          <div className="chart-container">
                            <SimpleChart
                              data={sampleData}
                              title="Time Series Visualization"
                              height={220}
                              yMin={min}
                              yMax={max}
                            />
                            <p className="chart-hint">
                              📈 Showing {Math.min(measVals.length, CHART_POINTS)} data points
                            </p>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </>
            ) : (
              <div className="empty-state small">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
                <p>No data values found for this instance</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="search-container">
      <div className="search-card">
        {/* Header */}
        <div className="search-header header-row">
          <div>
            <h2 className="search-title">Search Connections</h2>
            <p className="search-sub">
              Find schema relationships (and instances if needed) around a term.
            </p>
          </div>

          <div className="view-toggle seg">
            <button
              type="button"
              className={`seg-btn ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
            >
              List
            </button>
            <button
              type="button"
              className={`seg-btn ${view === "graph" ? "active" : ""}`}
              onClick={() => setView("graph")}
              title="Graph view"
            >
              Graph
            </button>
          </div>
        </div>

        {/* Form */}
        <form className="search-row" onSubmit={doSearch}>
          <input
            className="search-input"
            placeholder="Enter term (e.g., Pressure)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="search-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="schema">Schema only</option>
            <option value="both">Schema + data</option>
          </select>
          <button className="search-btn" type="submit">
            Search
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="skeleton-wrap">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        )}

        {/* Error */}
        {err && <div className="error-banner">{err}</div>}

        {/* Results */}
        {data && (
          <div className="results">
            <div className="result-meta">
              <div>
                <span className="badge">Center</span> {data.node}
              </div>
              <div className="meta-right">
                <span className="badge-outline">
                  nodes:{" "}
                  {Array.isArray(data.nodes)
                    ? data.nodes.length
                    : cyElements.filter(
                        (el) => el.data && el.data.id && !el.data.source,
                      ).length}
                </span>
                <span className="badge-outline">
                  edges: {data.edges?.length ?? 0}
                </span>
              </div>
            </div>

            {view === "list" && (
              <div className="edges">
                {data.edges?.map((e, i) => {
                  const s = e.source;
                  const t = e.target;

                  return (
                    <div className="edge-row" key={i}>
                      <div className="edge-col">
                        <span className="dot dot-src" />
                        <code
                          title={s}
                          style={{
                            cursor: isInstanceIri(s) ? "pointer" : "default",
                          }}
                          onClick={() =>
                            isInstanceIri(s) && loadInstanceDetails(s)
                          }
                        >
                          {displayLabel(s)}
                        </code>
                      </div>

                      <div className="edge-rel">
                        {displayPredicate(e.relation)}
                      </div>

                      <div className="edge-col">
                        <span className="dot dot-tgt" />
                        <code
                          title={t}
                          style={{
                            cursor: isInstanceIri(t) ? "pointer" : "default",
                          }}
                          onClick={() =>
                            isInstanceIri(t) && loadInstanceDetails(t)
                          }
                        >
                          {displayLabel(t)}
                        </code>
                      </div>
                    </div>
                  );
                })}

                {(!data.edges || data.edges.length === 0) && (
                  <div className="empty">No connections found.</div>
                )}
              </div>
            )}

            {view === "graph" && (
              <div className="graph-wrap" style={{ position: "relative" }}>
                {cyElements.length === 0 ? (
                  <div className="empty">No graph to display.</div>
                ) : (
                  <>
                    <CytoscapeComponent
                      elements={cyElements}
                      layout={{
                        name: "cose",
                        animate: "end",
                        fit: true,
                        padding: 30,
                      }}
                      stylesheet={stylesheet}
                      style={{ width: "100%", height: "520px" }}
                      wheelSensitivity={0.2}
                      cy={(cy) => {
                        // IMPORTANT: prevent duplicate handlers when React re-renders
                        cy.off("tap", "node");

                        cy.on("tap", "node", (evt) => {
                          const iri = evt.target.id();
                          if (isInstanceIri(iri)) loadInstanceDetails(iri);
                        });
                      }}
                    />

                    {/* Graph Color Legend Overlay */}
                    <div className="graph-legend">
                      <div className="legend-title">Node Color Legend</div>
                      <div className="legend-items">
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#eab308" }}></span>
                          <span className="legend-label">Searched Term</span>
                        </div>
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#ec4899" }}></span>
                          <span className="legend-label">Data / Values Node</span>
                        </div>
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#3b82f6" }}></span>
                          <span className="legend-label">Subclass</span>
                        </div>
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#8b5cf6" }}></span>
                          <span className="legend-label">Type / Class</span>
                        </div>
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#14b8a6" }}></span>
                          <span className="legend-label">Domain</span>
                        </div>
                        <div className="legend-item-row">
                          <span className="legend-color-dot" style={{ background: "#f97316" }}></span>
                          <span className="legend-label">Range</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Instance details panel */}
            {renderInstancePanel()}
          </div>
        )}
      </div>

      <style>{`
        .header-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
        }
        .view-toggle.seg {
          display: flex;
          background: var(--bg-glass);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: 4px;
          gap: 4px;
        }
        .seg-btn {
          appearance: none;
          border: none;
          background: transparent;
          padding: 8px 16px;
          font-weight: 600;
          font-size: 14px;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: all 0.2s ease;
        }
        .seg-btn:hover {
          background: rgba(0, 0, 0, 0.05);
          color: var(--text-primary);
        }
        .seg-btn.active {
          background: var(--gradient-primary);
          color: #fff;
          box-shadow: var(--shadow-sm);
        }
        .graph-wrap {
          height: 520px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
        }
      `}</style>
    </div>
  );
}
