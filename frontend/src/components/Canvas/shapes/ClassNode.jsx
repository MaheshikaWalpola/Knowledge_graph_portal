import React, { memo } from "react";
import { Handle, Position } from "reactflow";

const ClassNode = memo(({ data, selected }) => {
  return (
    <div
      className={`onto-node onto-class ${selected ? "selected" : ""}`}
      style={{ borderColor: data.color || "#3b82f6" }}
    >
      <Handle type="target" position={Position.Top} className="onto-handle" />
      <div className="onto-node-icon">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={data.color || "#3b82f6"} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="4" />
        </svg>
      </div>
      <div className="onto-node-label">{data.label || "Class"}</div>
      <Handle type="source" position={Position.Bottom} className="onto-handle" />
      <Handle type="source" position={Position.Right} id="right" className="onto-handle" />
      <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
    </div>
  );
});

ClassNode.displayName = "ClassNode";
export default ClassNode;
