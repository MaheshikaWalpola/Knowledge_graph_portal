import React from "react";
import { Button, Box } from "@mui/material";

const FILL = "var(--accent-primary, #2563eb)";
const TRACK = "#e6eefc";

/**
 * A button that becomes a progress bar while its action runs: a solid blue fill sweeps in from the
 * left over a light track, and the label reads the stage (e.g. "Verifying 3/10"). The label is drawn
 * twice, blue on the track and white inside the fill, clipped at the same edge, so it stays readable.
 *
 * Props:
 *   active    true while the action runs (the button is disabled and shows the fill)
 *   progress  0..100 for a known amount of work, or null for an unknown amount (a sweeping band)
 *   label     text shown while active; the children are shown otherwise
 *   ...rest   anything a MUI Button takes (variant, size, color, onClick, disabled, startIcon)
 */
export default function ProgressButton({ active = false, progress = null, label, children, disabled, sx, startIcon, endIcon, ...rest }) {
  const known = typeof progress === "number" && !Number.isNaN(progress);
  const pct = known ? Math.max(0, Math.min(100, progress)) : 0;
  const clip = known ? `inset(0 ${100 - pct}% 0 0)` : undefined;

  return (
    <Button
      {...rest}
      startIcon={active ? undefined : startIcon}
      endIcon={active ? undefined : endIcon}
      disabled={disabled || active}
      aria-busy={active || undefined}
      sx={{
        position: "relative",
        overflow: "hidden",
        ...(active && {
          "&.Mui-disabled": {
            color: FILL,
            backgroundColor: TRACK,
            border: `1px solid ${FILL}`,
            boxShadow: "none"
          }
        }),
        ...sx
      }}
    >
      <Box component="span" sx={{ whiteSpace: "nowrap" }}>
        {active ? label : children}
      </Box>
      {active && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: FILL,
            color: "#fff",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            clipPath: clip,
            transition: known ? "clip-path 400ms ease" : "none",
            animation: known ? "none" : "progress-button-sweep 1.6s ease-in-out infinite",
            "@keyframes progress-button-sweep": {
              "0%": { clipPath: "inset(0 100% 0 0)" },
              "50%": { clipPath: "inset(0 0 0 0)" },
              "100%": { clipPath: "inset(0 0 0 100%)" }
            }
          }}
        >
          {label}
        </Box>
      )}
    </Button>
  );
}
