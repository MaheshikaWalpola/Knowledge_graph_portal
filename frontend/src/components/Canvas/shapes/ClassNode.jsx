import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "@reactflow/node-resizer/dist/style.css";
import { checkClassName, useNodeCheck } from "../ontologyCheck";
import CheckMarker from "./CheckMarker";

const ClassNode = memo(({ id, data, selected }) => {
  const mark = useNodeCheck(id);
  return (
    <>
      <NodeResizer 
        color={data.color || "#3b82f6"} 
        isVisible={selected} 
        minWidth={50} 
        minHeight={25} 
        keepAspectRatio={true}
      />
      <div
        className={`onto-node onto-class ${selected ? "selected" : ""} ${checkClassName(mark)}`}
        style={{ 
          "--node-color": data.color || "#3b82f6",
          borderColor: "var(--node-color)" 
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

ClassNode.displayName = "ClassNode";
export default ClassNode;
