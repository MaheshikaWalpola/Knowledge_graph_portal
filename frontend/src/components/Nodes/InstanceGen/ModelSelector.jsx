import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControl,
  Select,
  MenuItem,
  Chip,
} from "@mui/material";
import { API } from "../../../config";

// The model list comes from the backend (GET /validation/models): backend/models.yaml merged with the
// models the Kiste server offers right now and the cloud providers whose API keys are set.
// Nothing is hard-coded here, so the dropdown always matches what the backend can actually call.

export default function ModelSelector({
  selectedModel,
  onModelChange,
  description = "Choose the AI model for intelligent header-to-schema matching",
  // Also offer the cloud providers (Claude, OpenAI); false keeps the list to the Kiste models
  includeCloud = false,
}) {
  const [models, setModels] = useState([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/validation/models`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        // Every model the Kiste server offers right now (catalog entry or not), plus the cloud models with keys
        const offered = (data.models || []).filter(
          (m) => m.available !== false && (includeCloud || m.provider === "kiste")
        );
        setModels(offered);
        setLoadError(false);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [includeCloud]);

  const labelOf = (model) => model.label;

  const renderModel = (model) => (
    <MenuItem key={model.model} value={model.model}>
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {labelOf(model)}
          </Typography>
          {model.tag && (
            <Chip
              label={model.tag}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem", ml: "auto" }}
            />
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25, ml: 3 }}>
          <Typography variant="caption" color="textSecondary">
            {model.description}
          </Typography>
          {model.context_window && (
            <Typography
              variant="caption"
              sx={{
                ml: "auto",
                color: "var(--text-secondary, #94a3b8)",
                fontFamily: "monospace",
                fontSize: "0.65rem",
              }}
            >
              ctx: {model.context_window}
            </Typography>
          )}
        </Box>
      </Box>
    </MenuItem>
  );

  return (
    <Card variant="outlined" sx={{ position: "relative", overflow: "visible" }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          AI Model
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          {description}
        </Typography>

        <FormControl fullWidth size="small" sx={{ mt: 1.5 }}>
          <Select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            displayEmpty
            renderValue={(value) => {
              const model = models.find((m) => m.model === value);
              // The list is still loading or could not be read: show the stored value as it is
              if (!model) return value || "Select a model";
              return (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <span>{labelOf(model)}</span>
                  {model.tag && (
                    <Chip
                      label={model.tag}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem", ml: "auto" }}
                    />
                  )}
                </Box>
              );
            }}
            sx={{
              "& .MuiSelect-select": {
                display: "flex",
                alignItems: "center",
              },
            }}
          >
            {models.map(renderModel)}
            {models.length === 0 && selectedModel && (
              <MenuItem value={selectedModel}>{selectedModel}</MenuItem>
            )}
          </Select>
        </FormControl>
        {loadError && (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
            The model list could not be loaded from the server. The current selection is kept.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
