import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import OntologyPalette from "./OntologyPalette";
import OntologyCanvas from "./OntologyCanvas";
import PropertyPanel from "./PropertyPanel";
import "./CanvasEditor.css";

// MUI Icons
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeMosaicIcon from "@mui/icons-material/AutoAwesomeMosaic";
import GridViewIcon from "@mui/icons-material/GridView";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import LayersClearIcon from "@mui/icons-material/LayersClear";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";

export default function CanvasEditor({ onOpenAuth }) {
  const [activeEdgeType, setActiveEdgeType] = useState("subClassOf");
  const [selected, setSelected] = useState(null);
  const [model, setModel] = useState({ nodes: [], edges: [] });
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState(false);

  const canvasRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

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
    navigate("/canvas", { replace: true, state: null });
  }, [navigate]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const found = canvasRef.current?.searchAndFocusNode?.(searchQuery.trim());
    if (!found) {
      setSearchError(true);
      setTimeout(() => setSearchError(false), 400);
    }
  }, [searchQuery]);

  const handleQuickConnect = useCallback((sourceId, newNodeType, label, connectionType, propertyType) => {
    console.log("CanvasEditor: handleQuickConnect called with:", { sourceId, newNodeType, label, connectionType, propertyType });
    if (!canvasRef.current) {
      console.error("CanvasEditor error: canvasRef.current is null!");
      return;
    }
    if (!canvasRef.current.quickConnect) {
      console.error("CanvasEditor error: quickConnect function is not defined on canvasRef.current!", canvasRef.current);
      return;
    }
    canvasRef.current.quickConnect(sourceId, newNodeType, label, connectionType, propertyType);
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
          <ViewSidebarIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Fullscreen / Header Toggle */}
        <button
          className={`ce-dock-btn ${headerHidden ? "active" : ""}`}
          onClick={() => setHeaderHidden((v) => !v)}
          title={headerHidden ? "Show navbar & footer" : "Hide navbar & footer (Fullscreen Canvas)"}
        >
          {headerHidden ? (
            <FullscreenExitIcon sx={{ fontSize: 18 }} />
          ) : (
            <FullscreenIcon sx={{ fontSize: 18 }} />
          )}
        </button>

        {/* Toggle Right Panel */}
        <button
          className={`ce-dock-btn ${!rightOpen ? "inactive" : ""}`}
          onClick={() => setRightOpen((v) => !v)}
          title={rightOpen ? "Hide Properties" : "Show Properties"}
        >
          <SpaceDashboardIcon sx={{ fontSize: 18 }} />
        </button>

        <div className="ce-dock-divider" />

        {/* Action: Undo */}
        <button
          className="ce-dock-btn action-btn"
          title="Undo"
          onClick={() => canvasRef.current?.undo()}
        >
          <UndoIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Redo */}
        <button
          className="ce-dock-btn action-btn"
          title="Redo"
          onClick={() => canvasRef.current?.redo()}
        >
          <RedoIcon sx={{ fontSize: 18 }} />
        </button>

        <div className="ce-dock-divider" />

        {/* Action: Select All */}
        <button
          className="ce-dock-btn action-btn"
          title="Select All"
          onClick={() => canvasRef.current?.selectAll()}
        >
          <SelectAllIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Delete Selected */}
        <button
          className={`ce-dock-btn action-btn ${!selected ? "disabled" : ""}`}
          title={selected ? "Delete selected element(s)" : "Select an element to delete"}
          onClick={() => {
            if (selected && selected.onDelete) {
              selected.onDelete();
              setSelected(null);
            }
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Clear Canvas */}
        <button
          className="ce-dock-btn action-btn"
          title="Clear entire canvas"
          onClick={() => setShowClearConfirm(true)}
        >
          <LayersClearIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Search */}
        <button
          className={`ce-dock-btn action-btn ${showSearch ? "active" : ""}`}
          title="Search nodes"
          onClick={() => {
            setShowSearch((prev) => !prev);
            setSearchQuery("");
            setSearchError(false);
          }}
        >
          <SearchIcon sx={{ fontSize: 18 }} />
        </button>

        {showSearch && (
          <div className={`ce-dock-search-container ${searchError ? "search-error" : ""}`}>
            <input
              type="text"
              placeholder=" Find element name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              autoFocus
              className="ce-dock-search-input"
            />
            {searchQuery && (
              <button
                className="ce-dock-search-clear"
                onClick={() => setSearchQuery("")}
                title="Clear query"
              >
                <ClearIcon sx={{ fontSize: 14 }} />
              </button>
            )}
          </div>
        )}

        <div className="ce-dock-divider" />

        {/* Action: Auto Layout -> Vertical Tree */}
        <button
          className="ce-dock-btn action-btn"
          title="Vertical Tree Layout"
          onClick={() => canvasRef.current?.applyLayout("vertical")}
        >
          <AccountTreeIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Auto Layout -> Horizontal */}
        <button
          className="ce-dock-btn action-btn"
          title="Horizontal Tree Layout"
          onClick={() => canvasRef.current?.applyLayout("horizontal")}
        >
          <AutoAwesomeMosaicIcon sx={{ fontSize: 18 }} />
        </button>

        {/* Action: Auto Layout -> Grid */}
        <button
          className="ce-dock-btn action-btn"
          title="Grid Layout"
          onClick={() => canvasRef.current?.applyLayout("grid")}
        >
          <GridViewIcon sx={{ fontSize: 18 }} />
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
            onQuickConnect={handleQuickConnect}
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
