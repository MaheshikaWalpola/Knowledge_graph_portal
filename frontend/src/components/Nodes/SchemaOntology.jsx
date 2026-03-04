import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import axios from "axios";
import "./SchemaOntology.css";

const API = import.meta.env.VITE_API_URL;
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

export default function SchemaOntology() {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const cyRef = useRef(null);

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
      nodeRepulsion: 250000000,
      idealEdgeLength: 200,
      edgeElasticity: 0.12,
      gravity: 0.06,

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
      {
        selector: ".hit",
        style: {
          "border-width": 4,
          "border-color": "#2563eb",
          "font-weight": 700,
        },
      },
    ],
    [],
  );

  // Fetch schema graph and build Cytoscape elements
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const res = await axios.get(`${API}/schema/graph`, {
          params: { limit: 20000 },
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
  }, []);

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
