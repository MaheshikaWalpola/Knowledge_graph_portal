import React from "react";
import { Button, Box } from "@mui/material";

/**
 * A button that turns into a progress bar while its action runs: the fill grows from the left
 * behind the label, and the label can report the stage (e.g. "Verifying 3/10").
 *
 * Props:
 *   active    true while the action runs (the button is disabled and shows the fill)
 *   progress  0..100 for a known amount of work, or null for an unknown amount (a sweeping fill)
 *   label     text shown while active; the children are shown otherwise
 *   ...rest   anything a MUI Button takes (variant, size, color, onClick, disabled, startIcon)
 */
export default function ProgressButton({ active = false, progress = null, label, children, disabled, sx, ...rest }) {
  const known = typeof progress === "number" && !Number.isNaN(progress);
  const pct = known ? Math.max(0, Math.min(100, progress)) : 0;

  return (
    <Button
      {...rest}
      disabled={disabled || active}
      sx={{ position: "relative", overflow: "hidden", ...sx }}
      aria-busy={active || undefined}
    >
      {active && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: known ? `${pct}%` : "40%",
            background: "currentColor",
            opacity: 0.22,
            transition: known ? "width 400ms ease" : "none",
            animation: known ? "none" : "progress-button-sweep 1.4s ease-in-out infinite",
            pointerEvents: "none",
            "@keyframes progress-button-sweep": {
              "0%": { transform: "translateX(-100%)" },
              "100%": { transform: "translateX(260%)" }
            }
          }}
        />
      )}
      <Box component="span" sx={{ position: "relative", whiteSpace: "nowrap" }}>
        {active ? label : children}
      </Box>
    </Button>
  );
}
