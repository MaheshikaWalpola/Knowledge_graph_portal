import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "@reactflow/node-resizer/dist/style.css";
import { checkClassName, useNodeCheck } from "../ontologyCheck";
import CheckMarker from "./CheckMarker";

const PropertyNode = memo(({ id, data, selected }) => {
  const mark = useNodeCheck(id);
  const color = data.color || "#f59e0b";
  const isDataProp = data.propertyType === "datatype";

  return (
    <>
      <NodeResizer 
        color={color} 
        isVisible={selected} 
        minWidth={38} 
        minHeight={38} 
        keepAspectRatio={true}
      />
      <div 
        className={`onto-node onto-property ${isDataProp ? "datatype" : "object"} ${selected ? "selected" : ""} ${checkClassName(mark)}`}
        style={{ 
          "--node-color": color
        }}
      >
        <Handle type="target" position={Position.Top} className="onto-handle" />
        <div className="onto-node-label">{data.label || "Unnamed"}</div>
        <Handle type="source" position={Position.Bottom} className="onto-handle" />
        <Handle type="source" position={Position.Right} id="right" className="onto-handle" />
        <Handle type="target" position={Position.Left} id="left" className="onto-handle" />
      </div>
      <CheckMarker mark={mark} />
    </>
  );
});

PropertyNode.displayName = "PropertyNode";
export default PropertyNode;
