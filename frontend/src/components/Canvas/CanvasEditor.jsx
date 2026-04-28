import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import OntologyPalette from "./OntologyPalette";
import OntologyCanvas from "./OntologyCanvas";
import PropertyPanel from "./PropertyPanel";
import "./CanvasEditor.css";

export default function CanvasEditor({ onOpenAuth }) {
  const [activeEdgeType, setActiveEdgeType] = useState("subClassOf");
  const [selected, setSelected] = useState(null);
  const [model, setModel] = useState({ nodes: [], edges: [] });
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);

  const canvasRef = useRef(null);
  const location = useLocation();

  const API = import.meta.env.VITE_API_URL;

  // Toggle a CSS class on the root element to hide/show the app header & footer
  useEffect(() => {
    const root = document.documentElement;
    if (headerHidden) {
      root.classList.add("ce-header-hidden");
    } else {
      root.classList.remove("ce-header-hidden");
    }
    // Cleanup on unmount (navigating away from canvas)
    return () => root.classList.remove("ce-header-hidden");
  }, [headerHidden]);

  const handleImport = useCallback((data) => {
    if (data?.nodes && data?.edges) {
      setModel(data);
      // Imperatively push new external state down into ReactFlow
      canvasRef.current?.importData(data);
    }
  }, []);

  // ── Auto-load schema from query param ──
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const schemaId = params.get("schema_id");
    if (!schemaId) return;

    const loadSchema = async () => {
      setIsLoadingSchema(true);
      const token = localStorage.getItem("token");
      try {
        // 1. Fetch the TTL export for this schema
        const exportRes = await fetch(`${API}/workspace/export?schema_id=${schemaId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!exportRes.ok) throw new Error("Failed to fetch schema export");
        const ttlContent = await exportRes.text();

        // 2. Convert to a File and send to the /canvas/import parser
        const blob = new Blob([ttlContent], { type: "text/turtle" });
        const file = new File([blob], `schema_${schemaId}.ttl`, { type: "text/turtle" });
        
        const form = new FormData();
        form.append("file", file);

        const importRes = await fetch(`${API}/canvas/import`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        
        if (!importRes.ok) throw new Error("Failed to parse schema for canvas");
        
        const data = await importRes.json();
        handleImport(data);
      } catch (err) {
        console.error("Auto-load schema error:", err);
      } finally {
        setIsLoadingSchema(false);
      }
    };

    loadSchema();
  }, [location.search, handleImport, API]);

  const handleClearCanvas = useCallback(() => {
    setModel({ nodes: [], edges: [] });
    canvasRef.current?.clearCanvas?.();
    setSelected(null);
    setShowClearConfirm(false);
  }, []);

  return (
    <div className={`canvas-editor ${!leftOpen ? "left-collapsed" : ""} ${!rightOpen ? "right-collapsed" : ""}`}>
      {isLoadingSchema && (
        <div className="ce-overlay-loading">
          <div className="ce-spinner"></div>
          <p>Loading ontology...</p>
        </div>
      )}
      
      {/* Central Floating Dock */}
      <div className="ce-dock">
        {/* Toggle Left Palette */}
        <button
          className={`ce-dock-btn ${!leftOpen ? "inactive" : ""}`}
          onClick={() => setLeftOpen((v) => !v)}
          title={leftOpen ? "Hide Palette" : "Show Palette"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        {/* Fullscreen / Header Toggle */}
        <button
          className={`ce-dock-btn ${headerHidden ? "active" : ""}`}
          onClick={() => setHeaderHidden((v) => !v)}
          title={headerHidden ? "Show navbar & footer" : "Hide navbar & footer (Fullscreen Canvas)"}
        >
          {headerHidden ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>

        {/* Toggle Right Panel */}
        <button
          className={`ce-dock-btn ${!rightOpen ? "inactive" : ""}`}
          onClick={() => setRightOpen((v) => !v)}
          title={rightOpen ? "Hide Properties" : "Show Properties"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
             <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
        
        <div className="ce-dock-divider" />

        {/* Action: Undo */}
        <button
          className="ce-dock-btn action-btn"
          title="Undo"
          onClick={() => {
            canvasRef.current?.undo();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 00-4-4H4" />
          </svg>
        </button>

        {/* Action: Redo */}
        <button
          className="ce-dock-btn action-btn"
          title="Redo"
          onClick={() => {
            canvasRef.current?.redo();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4" />
            <path d="M4 20v-7a4 4 0 014-4h12" />
          </svg>
        </button>
        
        <div className="ce-dock-divider" />

        {/* Action: Select All */}
        <button
          className="ce-dock-btn action-btn"
          title="Select All"
          onClick={() => {
            canvasRef.current?.selectAll();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="M13 13l6 6" />
          </svg>
        </button>

        {/* Action: Delete Selected */}
        <button
          className={`ce-dock-btn action-btn ${!selected ? "disabled" : ""}`}
          title={selected ? "Delete selected element(s)" : "Select an element to delete"}
          onClick={() => {
            if (selected && selected.onDelete) {
              selected.onDelete();
              setSelected(null); // Clear selection in editor state
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>

        {/* Action: Clear Canvas */}
        <button
          className="ce-dock-btn action-btn"
          title="Clear entire canvas"
          onClick={() => setShowClearConfirm(true)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* outer eraser shape */}
            <path d="M3 14L14 3c1-1 2.6-1 3.6 0l3.4 3.4c1 1 1 2.6 0 3.6L10 21c-1 1-2.6 1-3.6 0L3 17.6c-1-1-1-2.6 0-3.6z" />

            {/* split line */}
            <path d="M7 17l10-10" />
          </svg>
        </button>

        <div className="ce-dock-divider" />
        {/* Action: Auto Layout -> Vertical */}
        <button
          className="ce-dock-btn action-btn text-btn"
          title="Vertical Tree Layout"
          onClick={() => canvasRef.current?.applyLayout("vertical")}
        >
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>Tree</span>
        </button>

        {/* Action: Auto Layout -> Horizontal */}
        <button
          className="ce-dock-btn action-btn text-btn"
          title="Horizontal Tree Layout"
          onClick={() => canvasRef.current?.applyLayout("horizontal")}
        >
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>Row</span>
        </button>

        {/* Action: Auto Layout -> Grid */}
        <button
          className="ce-dock-btn action-btn text-btn"
          title="Grid Layout"
          onClick={() => canvasRef.current?.applyLayout("grid")}
        >
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>Grid</span>
        </button>

        </div>

      {/* Left palette */}
      <aside className={`ce-left ${!leftOpen ? "collapsed" : ""}`}>
        {leftOpen && (
          <OntologyPalette
            activeEdgeType={activeEdgeType}
            onEdgeTypeChange={setActiveEdgeType}
          />
        )}
      </aside>

      {/* Center canvas */}
      <main className="ce-center">
        <OntologyCanvas
          ref={canvasRef}
          activeEdgeType={activeEdgeType}
          onSelectionChange={setSelected}
          onModelChange={setModel}
        />
      </main>

      {/* Right property panel */}
      <aside className={`ce-right ${!rightOpen ? "collapsed" : ""}`}>
        {rightOpen && (
          <PropertyPanel
            selected={selected}
            model={model}
            onImport={handleImport}
            originalSchemaId={new URLSearchParams(location.search).get("schema_id")}
            originalName={location.state?.originalName}
            onOpenAuth={onOpenAuth}
          />
        )}
      </aside>

      {/* Clear Canvas Confirmation Dialog */}
      {showClearConfirm && (
        <div className="ce-modal-overlay">
          <div className="ce-modal">
            <h3>Clear Canvas</h3>
            <p>Do you want to fully clean the canvas? All nodes and edges will be removed.</p>
            <div className="ce-modal-actions">
              <button
                className="ce-modal-cancel"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="ce-modal-confirm"
                onClick={handleClearCanvas}
              >
                Yes, Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
