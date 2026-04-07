import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "@reactflow/node-resizer/dist/style.css";

const InstanceNode = memo(({ data, selected }) => {
  return (
    <>
      <NodeResizer 
        color={data.color || "#10b981"} 
        isVisible={selected} 
        minWidth={48} 
        minHeight={48} 
        keepAspectRatio={true}
      />
      <div
        className={`onto-node onto-instance ${selected ? "selected" : ""}`}
        style={{ 
          "--node-color": data.color || "#10b981",
          borderColor: "var(--node-color)" 
        }}
      >
        <Handle type="target" position={Position.Top} className="onto-handle" />
        <div className="onto-node-label">{data.label || "Unnamed"}</div>
        <Handle type="source" position={Position.Bottom} className="onto-handle" />
        <Handle type="source" position={Position.Right} id="right" className="onto-handle" />
        <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
      </div>
    </>
  );
});

InstanceNode.displayName = "InstanceNode";
export default InstanceNode;
