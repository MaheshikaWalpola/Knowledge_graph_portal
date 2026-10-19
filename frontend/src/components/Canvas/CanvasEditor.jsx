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
import { API } from "../../config";

// ─── Diff Engine ───────────────────────────────────────────
// Computes granular changes between two canvas model snapshots.

function computeModelDiff(oldModel, newModel) {
  const oldNodes = oldModel?.nodes || [];
  const newNodes = newModel?.nodes || [];
  const oldEdges = oldModel?.edges || [];
  const newEdges = newModel?.edges || [];

  const oldNodeMap = Object.fromEntries(oldNodes.map((n) => [n.id, n]));
  const newNodeMap = Object.fromEntries(newNodes.map((n) => [n.id, n]));
  const oldEdgeMap = Object.fromEntries(oldEdges.map((e) => [e.id, e]));
  const newEdgeMap = Object.fromEntries(newEdges.map((e) => [e.id, e]));

  const nodesAdded = [];
  const nodesRemoved = [];
  const nodesModified = [];
  const edgesAdded = [];
  const edgesRemoved = [];
  const edgesModified = [];

  // Nodes added / modified
  for (const n of newNodes) {
    if (!oldNodeMap[n.id]) {
      nodesAdded.push({
        id: n.id,
        label: n.data?.label || "",
        type: n.type || "",
      });
    } else {
      const old = oldNodeMap[n.id];
      const fields = ["label", "iri", "description"];
      for (const f of fields) {
        const oldVal = old.data?.[f] || "";
        const newVal = n.data?.[f] || "";
        if (oldVal !== newVal) {
          nodesModified.push({
            id: n.id,
            field: f,
            old: oldVal,
            new: newVal,
          });
        }
      }
      // Check type change
      if (old.type !== n.type) {
        nodesModified.push({
          id: n.id,
          field: "type",
          old: old.type || "",
          new: n.type || "",
        });
      }
    }
  }

  // Nodes removed
  for (const n of oldNodes) {
    if (!newNodeMap[n.id]) {
      nodesRemoved.push({
        id: n.id,
        label: n.data?.label || "",
        type: n.type || "",
      });
    }
  }

  // Edges added / modified
  for (const e of newEdges) {
    if (!oldEdgeMap[e.id]) {
      edgesAdded.push({
        id: e.id,
        source: e.source,
        target: e.target,
        edgeType: e.data?.edgeType || "",
      });
    } else {
      const old = oldEdgeMap[e.id];
      const oldType = old.data?.edgeType || "";
      const newType = e.data?.edgeType || "";
      if (oldType !== newType) {
        edgesModified.push({
          id: e.id,
          field: "edgeType",
          old: oldType,
          new: newType,
        });
      }
    }
  }

  // Edges removed
  for (const e of oldEdges) {
    if (!newEdgeMap[e.id]) {
      edgesRemoved.push({
        id: e.id,
        source: e.source,
        target: e.target,
        edgeType: e.data?.edgeType || "",
      });
    }
  }

  // Build summary text
  const parts = [];
  if (nodesAdded.length) parts.push(`Added ${nodesAdded.length} node(s)`);
  if (nodesRemoved.length) parts.push(`Removed ${nodesRemoved.length} node(s)`);
  if (nodesModified.length) parts.push(`Modified ${nodesModified.length} node property(ies)`);
  if (edgesAdded.length) parts.push(`Added ${edgesAdded.length} edge(s)`);
  if (edgesRemoved.length) parts.push(`Removed ${edgesRemoved.length} edge(s)`);
  if (edgesModified.length) parts.push(`Modified ${edgesModified.length} edge(s)`);
  const summary = parts.length > 0 ? parts.join(", ") : "No changes";

  return {
    nodes_added: nodesAdded,
    nodes_removed: nodesRemoved,
    nodes_modified: nodesModified,
    edges_added: edgesAdded,
    edges_removed: edgesRemoved,
    edges_modified: edgesModified,
    summary,
  };
}

function hasChanges(diff) {
  return (
    diff.nodes_added.length > 0 ||
    diff.nodes_removed.length > 0 ||
    diff.nodes_modified.length > 0 ||
    diff.edges_added.length > 0 ||
    diff.edges_removed.length > 0 ||
    diff.edges_modified.length > 0
  );
}

// ─── TTL Builder (shared with PropertyPanel) ────────────────
function buildTTL(model) {
  const wrap = (iri) =>
    iri.startsWith("http://") || iri.startsWith("https://") ? `<${iri}>` : iri;

  const lines = [
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix ex: <http://example.org/ontology#> .",
    "",
  ];

  const nodeMap = {};
  for (const n of model.nodes || []) {
    const iri =
      n.data?.iri || `ex:${(n.data?.label || n.id).replace(/\s+/g, "")}`;
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
    lines.push(`${wrap(iri)} a ${rdfType} .`);
    if (n.data?.label) {
      lines.push(`${wrap(iri)} rdfs:label "${n.data.label}" .`);
    }
    if (n.data?.description) {
      lines.push(`${wrap(iri)} rdfs:comment "${n.data.description}" .`);
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
    lines.push(`${wrap(srcIri)} ${wrap(pred)} ${wrap(tgtIri)} .`);
  }

  return lines.join("\n");
}

// ─── Component ─────────────────────────────────────────────

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

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogSource, setSaveDialogSource] = useState(null); // "ctrlS" | "button"

  // Snapshot tracking for history diff
  const lastSavedSnapshot = useRef({ nodes: [], edges: [] });

  // Save state (centralized)
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState(null);

  const canvasRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();


  // Derive schema context from URL
  const originalSchemaId = new URLSearchParams(location.search).get("schema_id");
  const originalName = location.state?.originalName || "";

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
      // After import, set the imported state as the baseline snapshot
      lastSavedSnapshot.current = {
        nodes: JSON.parse(JSON.stringify(data.nodes)),
        edges: JSON.parse(JSON.stringify(data.edges)),
      };
    }
  }, []);

  // Auto-load schema from query param
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
  }, [location.search, handleImport]);

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

  // ─── Centralized Save + History Log ────────────────────────

  const performSave = useCallback(async (saveName) => {
    setSaveError(null);
    setSaveSuccess("");

    if (!saveName?.trim()) {
      setSaveError({ summary: "Please provide a name for the ontology.", technical: "" });
      return false;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      if (onOpenAuth) onOpenAuth();
      else setSaveError({ summary: "You must be logged in to save.", technical: "" });
      return false;
    }

    const hasContent = model && (model.nodes?.length || 0) > 0;
    if (!hasContent) {
      setSaveError({ summary: "Add nodes to the canvas before saving.", technical: "" });
      return false;
    }

    const isUpdate = !!(
      hasContent &&
      originalSchemaId &&
      originalName &&
      saveName.trim().toLowerCase() === originalName.trim().toLowerCase()
    );

    setSaving(true);

    try {
      // 1. Build TTL and save to workspace
      const ttlContent = buildTTL(model);
      const blob = new Blob([ttlContent], { type: "text/turtle" });
      const file = new File([blob], `${saveName.trim().replace(/\s+/g, "_")}.ttl`, {
        type: "text/turtle",
      });

      const form = new FormData();
      form.append("name", saveName.trim());
      form.append("mode", "combined");
      form.append("schema_file", file);
      if (isUpdate) form.append("update_schema_id", originalSchemaId);

      const resp = await fetch(`${API}/workspace/schema/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        const d = detail.detail;
        if (d && typeof d === "object" && d.summary)
          throw { summary: d.summary, technical: d.technical || "" };
        throw {
          summary: (typeof d === "string" ? d : null) || "Save failed",
          technical: "",
        };
      }

      const result = await resp.json();

      // 2. Compute diff and log history
      const schemaId = result?.schema?.schema_id || originalSchemaId || saveName.trim();
      const diff = computeModelDiff(lastSavedSnapshot.current, model);
      const action = hasChanges(diff) && lastSavedSnapshot.current.nodes.length > 0 ? "updated" : "created";

      try {
        await fetch(`${API}/history/log`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            schema_id: schemaId,
            schema_name: saveName.trim(),
            action,
            changes: diff,
          }),
        });
      } catch (logErr) {
        console.warn("Failed to log history:", logErr);
      }

      // 3. Update snapshot
      lastSavedSnapshot.current = {
        nodes: JSON.parse(JSON.stringify(model.nodes || [])),
        edges: JSON.parse(JSON.stringify(model.edges || [])),
      };

      setSaveSuccess(
        `"${saveName.trim()}" ${isUpdate ? "updated in" : "saved to"} your workspace!`
      );
      setTimeout(() => setSaveSuccess(""), 3000);

      return true;
    } catch (err) {
      setSaveError(
        err.summary ? err : { summary: err.message || "Save failed", technical: "" }
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [model, originalSchemaId, originalName, API, onOpenAuth]);

  // ─── Ctrl+S Keyboard Shortcut ──────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();

        const token = localStorage.getItem("token");
        if (!token) {
          if (onOpenAuth) onOpenAuth();
          return;
        }

        const hasContent = model && (model.nodes?.length || 0) > 0;
        if (!hasContent) return;

        setSaveDialogSource("ctrlS");
        setShowSaveDialog(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [model, onOpenAuth]);

  // Save dialog name input & UI state
  const [modalSaveName, setModalSaveName] = useState(originalName || "");
  const [modalNameError, setModalNameError] = useState("");
  const [showDetailedChanges, setShowDetailedChanges] = useState(false);

  // Sync modalSaveName when originalName changes
  useEffect(() => {
    setModalSaveName(originalName || "");
  }, [originalName]);

  // Open save dialog helper
  const openSaveDialog = useCallback((source = "button") => {
    setModalSaveName(originalName || "");
    setModalNameError("");
    setSaveDialogSource(source);
    setShowSaveDialog(true);
  }, [originalName]);

  // Called by PropertyPanel's save button or dock button
  const handleTriggerSave = useCallback(() => {
    openSaveDialog("button");
  }, [openSaveDialog]);

  // ─── Ctrl+S Keyboard Shortcut ──────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();

        const token = localStorage.getItem("token");
        if (!token) {
          if (onOpenAuth) onOpenAuth();
          return;
        }

        const hasContent = model && (model.nodes?.length || 0) > 0;
        if (!hasContent) return;

        openSaveDialog("ctrlS");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [model, onOpenAuth, openSaveDialog]);

  // ─── Save Dialog Handlers ──────────────────────────────────

  const handleSaveConfirm = useCallback(async () => {
    const nameToSave = modalSaveName.trim() || originalName?.trim();
    if (!nameToSave) {
      setModalNameError("Please enter a name for the ontology.");
      return;
    }

    setModalNameError("");
    const success = await performSave(nameToSave);
    if (success) {
      setShowSaveDialog(false);
      setSaveDialogSource(null);
    }
  }, [modalSaveName, originalName, performSave]);

  const handleDontSave = useCallback(() => {
    setShowSaveDialog(false);
    setSaveDialogSource(null);
    setModalNameError("");
  }, []);

  const handleSaveCancel = useCallback(() => {
    setShowSaveDialog(false);
    setSaveDialogSource(null);
    setModalNameError("");
  }, []);

  // ─── Compute current diff for display ──────────────────────

  const currentDiff = showSaveDialog
    ? computeModelDiff(lastSavedSnapshot.current, model)
    : null;

  const totalChangeCount = currentDiff
    ? currentDiff.nodes_added.length +
      currentDiff.nodes_removed.length +
      currentDiff.nodes_modified.length +
      currentDiff.edges_added.length +
      currentDiff.edges_removed.length +
      currentDiff.edges_modified.length
    : 0;

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
            originalSchemaId={originalSchemaId}
            originalName={originalName}
            onOpenAuth={onOpenAuth}
            onQuickConnect={handleQuickConnect}
            onTriggerSave={handleTriggerSave}
            onPerformSave={performSave}
            saving={saving}
            saveSuccess={saveSuccess}
            saveError={saveError}
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

      {/* ─── Save / Don't Save / Cancel Dialog ─────────────── */}
      {showSaveDialog && (
        <div className="ce-modal-overlay ce-save-overlay" onClick={handleSaveCancel}>
          <div className="ce-modal ce-save-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="ce-save-modal-header">
              <div className="ce-save-modal-title-group">
                <div className="ce-save-modal-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                </div>
                <div>
                  <h3 className="ce-save-modal-title">Save Changes</h3>
                  <p className="ce-save-modal-subtitle">
                    {originalName ? "Save modifications to your ontology workspace" : "Save this schema to your workspace"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="ce-save-modal-close"
                onClick={handleSaveCancel}
                title="Close"
              >
                <ClearIcon sx={{ fontSize: 18 }} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="ce-save-modal-body">
              {/* Ontology Name Input / Display */}
              <div className="ce-save-name-section">
                <label className="ce-save-input-label">
                  Ontology Name
                  {originalName && <span className="ce-save-badge-status">Existing Schema</span>}
                </label>
                <input
                  type="text"
                  className={`ce-save-input ${modalNameError ? "has-error" : ""}`}
                  value={modalSaveName}
                  onChange={(e) => {
                    setModalSaveName(e.target.value);
                    if (modalNameError) setModalNameError("");
                  }}
                  placeholder="e.g., My Custom Ontology"
                  autoFocus={!originalName}
                />
                {modalNameError && (
                  <span className="ce-save-field-error">{modalNameError}</span>
                )}
              </div>

              {/* Changes Detected Card */}
              {currentDiff && hasChanges(currentDiff) ? (
                <div className="ce-save-diff-card">
                  <div className="ce-save-diff-header">
                    <div className="ce-save-diff-status">
                      <span className="ce-diff-pulse-dot" />
                      <strong>Changes Detected</strong>
                    </div>
                    <span className="ce-diff-count-badge">
                      {totalChangeCount} change{totalChangeCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Summary Pills */}
                  <div className="ce-save-pills-row">
                    {currentDiff.nodes_added.length > 0 && (
                      <span className="ce-diff-pill added">
                        +{currentDiff.nodes_added.length} Node{currentDiff.nodes_added.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {currentDiff.nodes_removed.length > 0 && (
                      <span className="ce-diff-pill removed">
                        -{currentDiff.nodes_removed.length} Node{currentDiff.nodes_removed.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {currentDiff.nodes_modified.length > 0 && (
                      <span className="ce-diff-pill modified">
                        ~{currentDiff.nodes_modified.length} Property{currentDiff.nodes_modified.length > 1 ? "ies" : ""}
                      </span>
                    )}
                    {currentDiff.edges_added.length > 0 && (
                      <span className="ce-diff-pill added">
                        +{currentDiff.edges_added.length} Edge{currentDiff.edges_added.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {currentDiff.edges_removed.length > 0 && (
                      <span className="ce-diff-pill removed">
                        -{currentDiff.edges_removed.length} Edge{currentDiff.edges_removed.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {currentDiff.edges_modified.length > 0 && (
                      <span className="ce-diff-pill modified">
                        ~{currentDiff.edges_modified.length} Edge Type{currentDiff.edges_modified.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Toggle Detailed List */}
                  <button
                    type="button"
                    className="ce-diff-toggle-btn"
                    onClick={() => setShowDetailedChanges((prev) => !prev)}
                  >
                    <span>{showDetailedChanges ? "Hide details" : "View change details"}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: showDetailedChanges ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {/* Detailed List */}
                  {showDetailedChanges && (
                    <div className="ce-diff-details-list">
                      {currentDiff.nodes_added.map((n) => (
                        <div key={`na_${n.id}`} className="ce-diff-item add">
                          <span className="ce-diff-tag add">+</span>
                          <span className="ce-diff-item-text">
                            Added <strong>{n.label || n.id}</strong> ({n.type})
                          </span>
                        </div>
                      ))}
                      {currentDiff.nodes_removed.map((n) => (
                        <div key={`nr_${n.id}`} className="ce-diff-item del">
                          <span className="ce-diff-tag del">-</span>
                          <span className="ce-diff-item-text">
                            Removed <strong>{n.label || n.id}</strong>
                          </span>
                        </div>
                      ))}
                      {currentDiff.nodes_modified.map((m, idx) => (
                        <div key={`nm_${m.id}_${idx}`} className="ce-diff-item mod">
                          <span className="ce-diff-tag mod">~</span>
                          <span className="ce-diff-item-text">
                            Modified {m.field}: <del>{m.old || "none"}</del> → <ins>{m.new}</ins>
                          </span>
                        </div>
                      ))}
                      {currentDiff.edges_added.map((e) => (
                        <div key={`ea_${e.id}`} className="ce-diff-item add">
                          <span className="ce-diff-tag add">+</span>
                          <span className="ce-diff-item-text">
                            Added relation: <strong>{e.edgeType}</strong>
                          </span>
                        </div>
                      ))}
                      {currentDiff.edges_removed.map((e) => (
                        <div key={`er_${e.id}`} className="ce-diff-item del">
                          <span className="ce-diff-tag del">-</span>
                          <span className="ce-diff-item-text">
                            Removed relation: <strong>{e.edgeType}</strong>
                          </span>
                        </div>
                      ))}
                      {currentDiff.edges_modified.map((e, idx) => (
                        <div key={`em_${e.id}_${idx}`} className="ce-diff-item mod">
                          <span className="ce-diff-tag mod">~</span>
                          <span className="ce-diff-item-text">
                            Relation changed: <del>{e.old}</del> → <ins>{e.new}</ins>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="ce-save-diff-card ce-diff-empty">
                  <div className="ce-diff-empty-icon">✓</div>
                  <div className="ce-diff-empty-text">
                    <strong>Version Up to Date</strong>
                    <span>No changes detected since last save.</span>
                  </div>
                </div>
              )}

              {saveError && (
                <div className="ce-save-error-banner">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{saveError.summary || "Save failed"}</span>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="ce-save-modal-actions">
              <button
                type="button"
                className="ce-save-btn ce-save-btn-dont"
                onClick={handleDontSave}
              >
                Don't Save
              </button>
              <div className="ce-save-actions-right">
                <button
                  type="button"
                  className="ce-save-btn ce-save-btn-cancel"
                  onClick={handleSaveCancel}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ce-save-btn ce-save-btn-save"
                  onClick={handleSaveConfirm}
                  disabled={saving}
                >
                  {saving ? (
                    <><span className="pp-spinner" />Saving...</>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      {originalName ? "Save Changes" : "Save Ontology"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

