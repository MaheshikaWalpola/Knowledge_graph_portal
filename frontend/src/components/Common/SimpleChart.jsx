// Interactive Chart Component
// Lightweight canvas-based line chart with click-to-view

import React, { useRef, useEffect, useState, useCallback } from "react";

/**
 * An interactive line chart component using canvas
 * @param {Object} props
 * @param {number[]} props.data        - Array of numeric values to plot
 * @param {string}  props.title        - Chart title
 * @param {number}  props.width        - Chart width (default: 100%)
 * @param {number}  props.height       - Chart height (default: 200px)
 * @param {string}  props.lineColor    - Line color (default: gradient purple)
 * @param {string}  props.fillColor    - Area fill color
 * @param {number}  [props.yMin]       - Override Y-axis minimum (true dataset min)
 * @param {number}  [props.yMax]       - Override Y-axis maximum (true dataset max)
 */
export default function SimpleChart({
  data = [],
  title = "",
  width = "100%",
  height = 200,
  lineColor = "#7c3aed",
  fillColor = "rgba(37, 99, 235, 0.1)",
  yMin = undefined,
  yMax = undefined,
}) {
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredIndex, setHoveredIndex] = useState(-1);

  // Store chart dimensions for mouse events
  const chartRef = useRef({
    padding: { top: 30, right: 20, bottom: 40, left: 50 },
    chartW: 0,
    chartH: 0,
    w: 0,
    minVal: 0,
    maxVal: 0,
    range: 1,
  });

  const drawChart = useCallback(
    (highlightIndex = -1) => {
      if (!canvasRef.current || data.length === 0) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();

      // Set actual size for high DPI
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const padding = { top: 30, right: 20, bottom: 40, left: 50 };
      const chartW = w - padding.left - padding.right;
      const chartH = h - padding.top - padding.bottom;

      // Store for mouse events — use override min/max when provided so the
      // Y-axis reflects the TRUE full-dataset range, not just the visible sample.
      const dataMin = Math.min(...data);
      const dataMax = Math.max(...data);
      const effectiveMin = yMin !== undefined ? Math.min(yMin, dataMin) : dataMin;
      const effectiveMax = yMax !== undefined ? Math.max(yMax, dataMax) : dataMax;
      const effectiveRange = effectiveMax - effectiveMin || 1;

      chartRef.current = {
        padding,
        chartW,
        chartH,
        w,
        h,
        minVal: effectiveMin,
        maxVal: effectiveMax,
        range: effectiveRange,
      };

      const { minVal, maxVal, range } = chartRef.current;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Helper to convert data to canvas coordinates
      const toX = (i) => padding.left + (i / (data.length - 1 || 1)) * chartW;
      const toY = (val) =>
        padding.top + chartH - ((val - minVal) / range) * chartH;

      // Draw grid lines
      ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
      ctx.lineWidth = 1;

      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
      }

      // Draw area fill with gradient
      const areaGradient = ctx.createLinearGradient(
        0,
        padding.top,
        0,
        h - padding.bottom,
      );
      areaGradient.addColorStop(0, "rgba(37, 99, 235, 0.15)");
      areaGradient.addColorStop(1, "rgba(37, 99, 235, 0.02)");

      ctx.beginPath();
      ctx.moveTo(toX(0), toY(data[0]));
      for (let i = 1; i < data.length; i++) {
        ctx.lineTo(toX(i), toY(data[i]));
      }
      ctx.lineTo(toX(data.length - 1), padding.top + chartH);
      ctx.lineTo(toX(0), padding.top + chartH);
      ctx.closePath();
      ctx.fillStyle = areaGradient;
      ctx.fill();

      // Draw line with gradient
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, "#7c3aed");
      gradient.addColorStop(0.5, "#2563eb");
      gradient.addColorStop(1, "#06b6d4");

      ctx.beginPath();
      ctx.moveTo(toX(0), toY(data[0]));
      for (let i = 1; i < data.length; i++) {
        ctx.lineTo(toX(i), toY(data[i]));
      }
      ctx.strokeStyle = lineColor === "#7c3aed" ? gradient : lineColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Draw dots
      for (let i = 0; i < data.length; i++) {
        const isHighlighted = i === highlightIndex;
        const dotRadius = isHighlighted ? 6 : 4;

        // Outer glow for highlighted
        if (isHighlighted) {
          ctx.beginPath();
          ctx.arc(toX(i), toY(data[i]), 12, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(37, 99, 235, 0.2)";
          ctx.fill();
        }

        // Draw dot
        ctx.beginPath();
        ctx.arc(toX(i), toY(data[i]), dotRadius, 0, Math.PI * 2);

        // Gradient color based on position
        const t = i / (data.length - 1 || 1);
        const r = Math.round(124 + (6 - 124) * t);
        const g = Math.round(58 + (182 - 58) * t);
        const b = Math.round(237 + (212 - 237) * t);
        ctx.fillStyle = isHighlighted ? "#7c3aed" : `rgb(${r}, ${g}, ${b})`;
        ctx.fill();

        // White border
        ctx.strokeStyle = "white";
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.stroke();
      }

      // Y-axis labels
      ctx.fillStyle = "#64748b";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const val = minVal + (range / 4) * (4 - i);
        const y = padding.top + (chartH / 4) * i;
        ctx.fillText(val.toFixed(1), padding.left - 8, y + 4);
      }

      // X-axis labels (show fewer based on data density)
      ctx.textAlign = "center";
      const numLabels = Math.min(5, data.length);
      for (let i = 0; i < numLabels; i++) {
        const dataIndex = Math.floor(
          (i / (numLabels - 1 || 1)) * (data.length - 1),
        );
        ctx.fillText(dataIndex + 1, toX(dataIndex), h - padding.bottom + 20);
      }

      // Title
      if (title) {
        ctx.fillStyle = "#1e293b";
        ctx.font = "600 13px Inter, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(title, padding.left, 18);
      }



      // Draw vertical line and value label for highlighted point
      if (highlightIndex >= 0 && highlightIndex < data.length) {
        const x = toX(highlightIndex);
        const y = toY(data[highlightIndex]);

        // Vertical guide line
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [data, title, lineColor, fillColor, yMin, yMax],
  );

  useEffect(() => {
    drawChart(hoveredIndex);
  }, [drawChart, hoveredIndex]);

  const handleMouseMove = useCallback(
    (e) => {
      if (!canvasRef.current || data.length === 0) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { padding, chartW } = chartRef.current;

      // Calculate which point is closest
      const relX = x - padding.left;
      const index = Math.round((relX / chartW) * (data.length - 1));

      if (index >= 0 && index < data.length) {
        const toX = (i) => padding.left + (i / (data.length - 1 || 1)) * chartW;
        const toY = (val) =>
          chartRef.current.padding.top +
          chartRef.current.chartH -
          ((val - chartRef.current.minVal) / chartRef.current.range) *
            chartRef.current.chartH;

        setHoveredIndex(index);
        setTooltip({
          x: toX(index),
          y: toY(data[index]) - 40,
          value: data[index],
          index: index + 1,
        });
      }
    },
    [data],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(-1);
    setTooltip(null);
  }, []);

  if (data.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-glass)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          color: "var(--text-tertiary)",
          fontSize: "14px",
        }}
      >
        No data to display
      </div>
    );
  }

  return (
    <div style={{ width, position: "relative" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          width: "100%",
          height: `${height}px`,
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-glass)",
          border: "1px solid var(--border-light)",
          cursor: "crosshair",
        }}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: "translateX(-50%)",
            padding: "8px 12px",
            background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
            color: "white",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: "600",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.4)",
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
            animation: "fadeIn 0.15s ease",
          }}
        >
          <div style={{ opacity: 0.8, fontSize: 10, marginBottom: 2 }}>
            Point #{tooltip.index}
          </div>
          <div style={{ fontSize: 14 }}>{tooltip.value.toFixed(4)}</div>
        </div>
      )}
    </div>
  );
}
