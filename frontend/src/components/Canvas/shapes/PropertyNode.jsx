import React, { memo } from "react";
import { Handle, Position } from "reactflow";

const PropertyNode = memo(({ data, selected }) => {
  const color = data.color || "#f59e0b";
  const isDataProp = data.propertyType === "datatype";

  return (
    <div className={`onto-node onto-property ${isDataProp ? "datatype" : "object"} ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="onto-handle" />
      <div className="onto-diamond" style={{ borderColor: color }}>
        <div className="onto-node-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={color} strokeWidth="2.5">
            {isDataProp ? (
              <>
                <path d="M12 2 L22 12 L12 22 L2 12 Z" />
                <circle cx="12" cy="12" r="2" fill={color} />
              </>
            ) : (
              <path d="M12 2 L22 12 L12 22 L2 12 Z" />
            )}
          </svg>
        </div>
        <div className="onto-node-label">{data.label || "Property"}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="onto-handle" />
      <Handle type="source" position={Position.Right} id="right" className="onto-handle" />
      <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
    </div>
  );
});

PropertyNode.displayName = "PropertyNode";
export default PropertyNode;
