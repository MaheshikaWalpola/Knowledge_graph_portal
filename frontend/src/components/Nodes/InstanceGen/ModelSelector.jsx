import React from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControl,
  Select,
  MenuItem,
  Chip,
  Tooltip,
} from "@mui/material";

// Kiste models with metadata for display
const KISTE_MODELS = [
  {
    id: "Qwen3.6-35B-A3B-MLX-8bit",
    label: "Qwen 3.6 35B",
    description: "Best for general-purpose matching tasks",
    contextWindow: "262K",
    tag: "Recommended",
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
  {
    id: "Phi-3-mini-4k-instruct-mlx",
    label: "Phi-3 Mini 4K",
    description: "Microsoft's compact model, limited context",
    contextWindow: "4K",
    tag: "Compact",
  },
];

export default function ModelSelector({ selectedModel, onModelChange }) {
  const currentModel = KISTE_MODELS.find((m) => m.id === selectedModel) || KISTE_MODELS[0];

  return (
    <Card variant="outlined" sx={{ position: "relative", overflow: "visible" }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          AI Model
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Choose the AI model for intelligent header-to-schema matching
        </Typography>

        <FormControl fullWidth size="small" sx={{ mt: 1.5 }}>
          <Select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            displayEmpty
            renderValue={(value) => {
              const model = KISTE_MODELS.find((m) => m.id === value);
              if (!model) return "Select a model";
              return (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <span>{model.label}</span>
                  {model.tag && (
                    <Chip
                      label={model.tag}
                      size="small"
                      color={model.tag === "Recommended" ? "primary" : "default"}
                      variant={model.tag === "Recommended" ? "filled" : "outlined"}
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
            {KISTE_MODELS.map((model) => (
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
                        color={model.tag === "Recommended" ? "primary" : "default"}
                        variant={model.tag === "Recommended" ? "filled" : "outlined"}
                        sx={{ height: 18, fontSize: "0.65rem", ml: "auto" }}
                      />
                    )}
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25, ml: 3 }}>
                    <Typography variant="caption" color="textSecondary">
                      {model.description}
                    </Typography>
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
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </CardContent>
    </Card>
  );
}
