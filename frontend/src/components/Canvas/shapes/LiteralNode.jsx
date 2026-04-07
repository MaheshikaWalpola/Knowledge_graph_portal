import React, { memo } from "react";
import { Handle, Position } from "reactflow";

const LiteralNode = memo(({ data, selected }) => {
  return (
    <div
      className={`onto-node onto-literal ${selected ? "selected" : ""}`}
      style={{ borderColor: data.color || "#8b5cf6" }}
    >
      <Handle type="target" position={Position.Top} className="onto-handle" />
      <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
      <div className="onto-node-icon">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={data.color || "#8b5cf6"} strokeWidth="2">
          <rect x="2" y="6" width="20" height="12" rx="6" />
        </svg>
      </div>
      <div className="onto-node-label">{data.label || "Literal"}</div>
    </div>
  );
});

LiteralNode.displayName = "LiteralNode";
export default LiteralNode;
