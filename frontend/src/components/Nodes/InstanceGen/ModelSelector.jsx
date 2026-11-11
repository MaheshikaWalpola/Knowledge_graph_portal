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

// Kiste models (TU Chemnitz server) with metadata for display
const KISTE_MODELS = [
  {
    id: "Qwen3.6-35B-A3B-MLX-8bit",
    label: "Qwen 3.6 35B",
    description: "Best for general-purpose matching tasks",
    contextWindow: "262K",
    tag: null,
  },
  {
    id: "DeepSeek-V4-Flash-0731-MXFP4-MLX",
    label: "DeepSeek V4 Flash",
    description: "Fast responses with large context window",
    contextWindow: "1M",
    tag: null,
  },
  {
    id: "gpt-oss-120b-MLX-8bit",
    label: "GPT-OSS 120B (8-bit)",
    description: "High-quality reasoning, larger model",
    contextWindow: "131K",
    tag: null,
  },
  {
    id: "gpt-oss-120b-MXFP4-Q8",
    label: "GPT-OSS 120B (MXFP4)",
    description: "Quantized variant, slightly faster",
    contextWindow: "131K",
    tag: null,
  },
  {
    id: "gemma-4-26B-A4B-it-QAT-MLX-4bit",
    label: "Gemma 4 26B",
    description: "Google's efficient instruction-tuned model",
    contextWindow: "262K",
    tag: null,
  },
  {
    id: "Hunyuan-MT-7B-8bit",
    label: "Hunyuan MT 7B",
    description: "Lightweight and fast, smaller context",
    contextWindow: "32K",
    tag: "Fast",
  },
];


export default function ModelSelector({
  selectedModel,
  onModelChange,
  description = "Choose the AI model for intelligent header-to-schema matching",
  // Also offer the cloud providers (Claude, OpenAI) whose API keys are configured on the server
  includeCloud = false,
}) {
  const [cloudModels, setCloudModels] = useState([]);

  useEffect(() => {
    if (!includeCloud) return;
    let cancelled = false;
    fetch(`${API}/validation/models`)
      .then((res) => (res.ok ? res.json() : { providers: [] }))
      .then((data) => { if (!cancelled) setCloudModels((data.providers || []).flatMap((p) => p.models)); })
      .catch(() => { if (!cancelled) setCloudModels([]); });
    return () => { cancelled = true; };
  }, [includeCloud]);

  // One flat list: the Kiste models first, then the cloud models the server offers
  const allModels = [...KISTE_MODELS, ...cloudModels];

  const renderModel = (model) => (
    <MenuItem key={model.id} value={model.id}>
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {model.label}
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
          {model.contextWindow && (
            <Typography
              variant="caption"
              sx={{
                ml: "auto",
                color: "var(--text-secondary, #94a3b8)",
                fontFamily: "monospace",
                fontSize: "0.65rem",
              }}
            >
              ctx: {model.contextWindow}
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
              const model = allModels.find((m) => m.id === value);
              if (!model) return "Select a model";
              return (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <span>{model.label}</span>
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
            {allModels.map(renderModel)}
          </Select>
        </FormControl>
      </CardContent>
    </Card>
  );
}
