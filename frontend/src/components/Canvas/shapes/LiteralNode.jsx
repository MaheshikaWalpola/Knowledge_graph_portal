import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "@reactflow/node-resizer/dist/style.css";

const LiteralNode = memo(({ data, selected }) => {
  return (
    <>
      <NodeResizer 
        color={data.color || "#8b5cf6"} 
        isVisible={selected} 
        minWidth={54} 
        minHeight={26} 
        keepAspectRatio={true}
      />
      <div
        className={`onto-node onto-literal ${selected ? "selected" : ""}`}
        style={{ 
          "--node-color": data.color || "#8b5cf6",
          borderColor: "var(--node-color)" 
        }}
      >
        <Handle type="target" position={Position.Top} className="onto-handle" />
        <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
        <div className="onto-node-label">{data.label || "Unnamed"}</div>
      </div>
    </>
  );
});

LiteralNode.displayName = "LiteralNode";
export default LiteralNode;
