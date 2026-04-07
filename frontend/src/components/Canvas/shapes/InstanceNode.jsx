import React, { memo } from "react";
import { Handle, Position } from "reactflow";

const InstanceNode = memo(({ data, selected }) => {
  return (
    <div
      className={`onto-node onto-instance ${selected ? "selected" : ""}`}
      style={{ borderColor: data.color || "#10b981" }}
    >
      <Handle type="target" position={Position.Top} className="onto-handle" />
      <div className="onto-node-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={data.color || "#10b981"} strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
      <div className="onto-node-label">{data.label || "Instance"}</div>
      <Handle type="source" position={Position.Bottom} className="onto-handle" />
      <Handle type="source" position={Position.Right} id="right" className="onto-handle" />
      <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
    </div>
  );
});

InstanceNode.displayName = "InstanceNode";
export default InstanceNode;
