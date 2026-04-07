import React, { useCallback, useRef, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

import ClassNode from "./shapes/ClassNode";
import PropertyNode from "./shapes/PropertyNode";
import InstanceNode from "./shapes/InstanceNode";
import LiteralNode from "./shapes/LiteralNode";

const nodeTypes = {
  classNode: ClassNode,
  propertyNode: PropertyNode,
  instanceNode: InstanceNode,
  literalNode: LiteralNode,
};

const EDGE_COLORS = {
  subClassOf: "#6366f1",
  domain: "#14b8a6",
  range: "#f97316",
  rdfType: "#8b5cf6",
  default: "#94a3b8",
};

const EDGE_LABELS = {
  subClassOf: "rdfs:subClassOf",
  domain: "rdfs:domain",
  range: "rdfs:range",
  rdfType: "rdf:type",
};

let idCounter = 0;
const nextId = () => `node_${++idCounter}`;

function CanvasInner({
  activeEdgeType,
  onSelectionChange,
  onModelChange,
  externalNodes,
  externalEdges,
}) {
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(externalNodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(externalEdges || []);

  // Sync external data
  React.useEffect(() => {
    if (externalNodes) setNodes(externalNodes);
  }, [externalNodes, setNodes]);

  React.useEffect(() => {
    if (externalEdges) setEdges(externalEdges);
  }, [externalEdges, setEdges]);

  // Report model changes upstream
  React.useEffect(() => {
    onModelChange?.({ nodes, edges });
  }, [nodes, edges, onModelChange]);

  const onConnect = useCallback(
    (params) => {
      const color = EDGE_COLORS[activeEdgeType] || EDGE_COLORS.default;
      const label = EDGE_LABELS[activeEdgeType] || activeEdgeType;

      const newEdge = {
        ...params,
        id: `e_${params.source}_${params.target}_${Date.now()}`,
        type: "default",
        animated: false,
        label,
        data: { edgeType: activeEdgeType },
        style: { stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        labelStyle: { fill: color, fontWeight: 600, fontSize: 11 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
      };

      setEdges((eds) => addEdge(newEdge, eds));
    },
    [activeEdgeType, setEdges]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const label = event.dataTransfer.getData("node/label") || type;
      const color = event.dataTransfer.getData("node/color") || "#3b82f6";
      const propertyType = event.dataTransfer.getData("node/propertyType") || "";

      const newNode = {
        id: nextId(),
        type,
        position,
        data: {
          label,
          color,
          propertyType,
          iri: "",
          description: "",
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onSelectionChangeHandler = useCallback(
    ({ nodes: selNodes, edges: selEdges }) => {
      if (selNodes.length === 1) {
        const n = selNodes[0];
        onSelectionChange?.({
          kind: "node",
          id: n.id,
          type: n.type,
          data: n.data,
          setLabel: (v) => {
            setNodes((nds) =>
              nds.map((nd) =>
                nd.id === n.id ? { ...nd, data: { ...nd.data, label: v } } : nd
              )
            );
          },
          setIri: (v) => {
            setNodes((nds) =>
              nds.map((nd) =>
                nd.id === n.id ? { ...nd, data: { ...nd.data, iri: v } } : nd
              )
            );
          },
          setDescription: (v) => {
            setNodes((nds) =>
              nds.map((nd) =>
                nd.id === n.id
                  ? { ...nd, data: { ...nd.data, description: v } }
                  : nd
              )
            );
          },
          onDelete: () => {
             setNodes((nds) => nds.filter((nd) => nd.id !== n.id));
             setEdges((eds) => eds.filter((ed) => ed.source !== n.id && ed.target !== n.id));
          }
        });
      } else if (selEdges.length === 1) {
        const e = selEdges[0];
        onSelectionChange?.({
          kind: "edge",
          id: e.id,
          label: e.label,
          data: e.data,
          setLabel: (v) => {
            setEdges((eds) =>
              eds.map((ed) => (ed.id === e.id ? { ...ed, label: v } : ed))
            );
          },
          onDelete: () => {
             setEdges((eds) => eds.filter((ed) => ed.id !== e.id));
          }
        });
      } else {
        onSelectionChange?.(null);
      }
    },
    [onSelectionChange, setNodes, setEdges]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { strokeWidth: 2, stroke: EDGE_COLORS.default },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.default },
    }),
    []
  );

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChangeHandler}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        snapToGrid
        snapGrid={[15, 15]}
      >
        <Background gap={20} size={1} color="#e5e7eb" />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export default function OntologyCanvas(props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
