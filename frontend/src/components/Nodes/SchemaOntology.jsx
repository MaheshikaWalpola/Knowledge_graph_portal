import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import axios from "axios";
import "./SchemaOntology.css";
import { API } from "../../config";

const local = (iri = "") => (iri || "").split("#").pop().split("/").pop();

function hashToIndex(str, modulo) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return Math.abs(h) % modulo;
}

// Crisp KG accents (ring colors)
// Workspace Palette
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

export default function SchemaOntology({ onOpenAuth }) {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const cyRef = useRef(null);

  // schemas list & selector
  const [schemas, setSchemas] = useState([]);
  const [activeSchemaId, setActiveSchemaId] = useState("");
  const [schemaSelectorOpen, setSchemaSelectorOpen] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const selectorRef = useRef(null);
  const token = localStorage.getItem("token");

  // Prompt login if no token
  useEffect(() => {
    if (!token && onOpenAuth) {
      onOpenAuth("/graph");
    }
  }, [token, onOpenAuth]);

  // close selector on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target)) {
        setSchemaSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredSchemas = useMemo(() => {
    if (!schemaSearch.trim()) return schemas;
    const term = schemaSearch.toLowerCase();
    return schemas.filter(s => s.name?.toLowerCase().includes(term));
  }, [schemas, schemaSearch]);

  const activeSchemaLabel = useMemo(() => {
    if (!activeSchemaId) return "Select an Ontology";
    const found = schemas.find((s) => s.schema_id === activeSchemaId);
    return found ? found.name : activeSchemaId;
  }, [activeSchemaId, schemas]);

  // Force layout tuned to reduce overlap
  const layout = useMemo(
    () => ({
      name: "cose",
      animate: "end",
      fit: true,
      padding: 90,

      // Important: layout accounts for labels when they show on hover/selection
      nodeDimensionsIncludeLabels: true,

      // Spacing controls (bigger => less overlap)
      nodeOverlap: 30,
      componentSpacing: 140,

      // Force tuning
      nodeRepulsion: 150000000,
      idealEdgeLength: 80,
      edgeElasticity: 0.12,
      gravity: 0.1,

      // Stability
      randomize: true,
      numIter: 2500,
      initialTemp: 200,
      coolingFactor: 0.99,
    }),
    [],
  );

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          label: "data(label)",
          color: "#111827",
          "font-size": 8,
          "text-wrap": "wrap",
          "text-max-width": 60,
          "text-valign": "center",
          "text-halign": "center",
          width: 36,
          height: 36,
          "border-width": 0,
        },
      },
      {
        selector: 'node[isCenter = "true"]',
        style: {
          width: 48,
          height: 48,
          "font-weight": 700,
          color: "#0f172a",
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#cbd5e1",
          "target-arrow-color": "#cbd5e1",
          "target-arrow-shape": "triangle",
          label: "data(label)",
          "font-size": 8,
          color: "#0f172a",
          "text-background-opacity": 1,
          "text-background-color": "#ffffff",
          "text-background-padding": 3,
          "text-background-shape": "roundrectangle",
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
      {
        selector: ".hit",
        style: {
          "border-width": 4,
          "border-color": "#AAFF00",
          "font-weight": 700,
        },
      },
    ],
    [],
  );

  useEffect(() => {
    const fetchSchemas = async () => {
      if (!token) return;
      try {
        const res = await axios.get(`${API}/workspace/schemas`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = (res.data?.schemas || []).filter(s => s.upload_mode !== "base");
        setSchemas(list);
        if (list.length > 0 && (!activeSchemaId || activeSchemaId === "main")) {
          setActiveSchemaId(list[0].schema_id);
        }
      } catch (e) {
        console.error("Failed to fetch schemas", e);
      }
    };
    fetchSchemas();
  }, [token]);

  // Fetch schema graph and build Cytoscape elements
  useEffect(() => {
    if (!activeSchemaId) return;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const res = await axios.get(`${API}/workspace/schema/graph`, {
          params: { schema_id: activeSchemaId, limit: 30000 },
          headers: { Authorization: `Bearer ${token}` },
        });
        const rawNodes = res.data.nodes || [];
        const rawEdges = res.data.edges || [];

        const nodes = rawNodes.map((n) => {
          const id = n.iri;
          return {
            data: {
              id,
              label: n.label || local(id),
              color: PALETTE[hashToIndex(id, PALETTE.length)],
            },
          };
        });

        const edges = rawEdges.map((e) => ({
          data: {
            id: `${e.source}__${e.relation}__${e.target}`,
            source: e.source,
            target: e.target,
            relation: e.relation,
            label: local(e.relation),
          },
        }));

        setElements([...nodes, ...edges]);
      } catch (e) {
        setErr(e?.response?.data?.detail || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeSchemaId, token]);

  // Re-run layout after elements load (helps spacing)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !elements.length) return;

    try {
      cy.layout(layout).run();
      cy.fit(undefined, 50);
    } catch {
      // ignore
    }
  }, [elements, layout]);

  const fit = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 80);
  };

  const zoomBy = (factor) => {
    const cy = cyRef.current;
    if (!cy) return;

    const next = cy.zoom() * factor;
    cy.zoom({
      level: next,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  const focusNode = (e) => {
    e?.preventDefault();
    const cy = cyRef.current;
    if (!cy) return;

    const needle = q.trim().toLowerCase();
    if (!needle) return;

    cy.nodes().removeClass("hit");

    const match = cy.nodes().filter((n) => {
      const id = (n.id() || "").toLowerCase();
      const label = (n.data("label") || "").toLowerCase();
      return (
        local(id).toLowerCase() === needle ||
        id.endsWith(needle) ||
        label.includes(needle)
      );
    });

    if (match.length) {
      // Prefer exact local-name match first
      const exact = match.filter((n) => local(n.id()).toLowerCase() === needle);

      const target = (exact.length ? exact : match)[0]; // pick ONE

      cy.nodes().removeClass("hit");
      target.addClass("hit");
      cy.$(":selected").unselect();
      target.select();

      // Smoothly center + zoom to a consistent level
      const ZOOM_TO = 1.2; // adjust as you like

      cy.animate(
        {
          center: { eles: target },
          zoom: ZOOM_TO,
        },
        { duration: 350 },
      );
    }
  };

  return (
    <div className="kg-container">
      <div className="kg-card">
        <div className="kg-header">
          <h2 className="kg-title">Schema Ontology</h2>
          <p className="kg-sub">
            Search and explore schema-level entities and relations.
          </p>
        </div>

        <form className="search-row" onSubmit={focusNode}>
          <div className="schema-selector" ref={selectorRef}>
            <button
              type="button"
              className="schema-selector-btn"
              onClick={() => setSchemaSelectorOpen(!schemaSelectorOpen)}
            >
              <span className="schema-selector-label">
                Ontology: <strong>{activeSchemaLabel}</strong>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {schemaSelectorOpen && (
              <div className="schema-selector-dropdown">
                <div className="schema-selector-search">
                  <input
                    type="text"
                    placeholder="Search schemas..."
                    value={schemaSearch}
                    onChange={(e) => setSchemaSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <ul className="schema-selector-list">
                  {filteredSchemas.map((s) => (
                    <li
                      key={s.schema_id}
                      className={`schema-selector-item ${activeSchemaId === s.schema_id ? "active" : ""}`}
                      onClick={() => {
                        setActiveSchemaId(s.schema_id);
                        setSchemaSelectorOpen(false);
                        setSchemaSearch("");
                      }}
                    >
                      {s.name}
                    </li>
                  ))}
                  {filteredSchemas.length === 0 && schemas.length > 0 && (
                    <li className="schema-selector-empty">No matching schemas</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <input
            className="search-input"
            placeholder="Find a node (e.g., Velocity)"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
          />
          <button className="search-btn" type="submit">
            Find
          </button>
          <button className="search-btn subtle" type="button" onClick={fit}>
            Overview
          </button>
        </form>

        {loading && <div className="kg-skeleton" />}
        {err && <div className="kg-error">{err}</div>}

        {!loading && !err && (
          <div className="graph-wrap">
            {/* Zoom controls */}
            <div className="kg-zoom-controls">
              <button
                className="zoom-btn"
                onClick={() => zoomBy(1.2)}
                title="Zoom in"
              >
                +
              </button>
              <button
                className="zoom-btn"
                onClick={() => zoomBy(0.8)}
                title="Zoom out"
              >
                −
              </button>
              <button className="zoom-btn" onClick={fit} title="Fit to screen">
                ⤢
              </button>
            </div>

            <CytoscapeComponent
              cy={(cy) => (cyRef.current = cy)}
              elements={elements}
              layout={layout}
              stylesheet={stylesheet}
              style={{ width: "100%", height: "72vh" }}
              wheelSensitivity={0.15}
            />
          </div>
        )}
      </div>
    </div>
  );
}
