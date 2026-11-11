import React, { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DownloadIcon from "@mui/icons-material/Download";

const API = import.meta.env.VITE_API_URL;

function downloadBlob(blob, filename) {
  const element = document.createElement("a");
  element.href = URL.createObjectURL(blob);
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(element.href);
}

export default function PdfToCsvCard({ schemaFile, selectedModel }) {
  const pdfInputRef = useRef(null);
  const [pdfFiles, setPdfFiles] = useState([]);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(null); // { index, total, file }
  const [fileResults, setFileResults] = useState([]); // { file, ok, stats | message }
  const [result, setResult] = useState(null); // final "done" event
  const [error, setError] = useState(null);

  const handlePdfFilesChange = (event) => {
    const files = event.target.files;
    if (files) {
      setPdfFiles((prev) => {
        const fileMap = new Map();
        prev.forEach((file) => fileMap.set(file.name, file));
        Array.from(files).forEach((file) => fileMap.set(file.name, file));
        return Array.from(fileMap.values());
      });
      event.target.value = "";
    }
  };

  const handlePdfFileRemove = (fileName) => {
    setPdfFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const handleConvert = async () => {
    setConverting(true);
    setError(null);
    setResult(null);
    setFileResults([]);
    setProgress(null);

    try {
      const formData = new FormData();
      formData.append("schema_file", schemaFile);
      pdfFiles.forEach((file) => formData.append("pdf_files", file));
      formData.append("model", selectedModel);

      const response = await fetch(`${API}/instance-generation/pdf-to-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: formData,
      });

      if (!response.ok) {
        let errMsg = `Failed to convert PDF files (Status: ${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.detail) errMsg = errData.detail;
        } catch {
          // Response body was not JSON; keep the status message
        }
        throw new Error(errMsg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);

          if (data.type === "file_start") {
            setProgress({ index: data.index, total: data.total, file: data.file });
          } else if (data.type === "file_done") {
            setFileResults((prev) => [...prev, { file: data.file, ok: true, stats: data }]);
          } else if (data.type === "file_error") {
            setFileResults((prev) => [...prev, { file: data.file, ok: false, message: data.message }]);
          } else if (data.type === "done") {
            setResult(data);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Failed to convert PDF files");
    } finally {
      setConverting(false);
      setProgress(null);
    }
  };

  const handleDownloadZip = () => {
    const bytes = Uint8Array.from(atob(result.zip_base64), (c) => c.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: "application/zip" }), "pdf_to_csv.zip");
  };

  const handleDownloadSummary = () => {
    const bytes = Uint8Array.from(atob(result.summary_pdf_base64), (c) => c.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "summary.pdf");
  };

  const handleDownloadFile = (file) => {
    downloadBlob(new Blob([file.content], { type: "text/csv" }), file.name);
  };

  const summary = result?.summary;
  const recordCount = summary
    ? Object.values(summary.records_per_class).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          PDF to CSV
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Convert PDF files (or a ZIP of PDFs) into CSV files aligned with the schema, using the
          AI model selected below. Check the CSVs, then add them as data files.
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 2, flexWrap: "wrap" }}>
          <Button
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            onClick={() => pdfInputRef.current?.click()}
            disabled={converting}
          >
            Choose PDF Files
          </Button>

          {pdfFiles.length > 0 && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {pdfFiles.map((file) => (
                <Chip
                  key={file.name}
                  icon={<CheckCircleIcon />}
                  label={file.name}
                  color="success"
                  variant="outlined"
                  onDelete={converting ? undefined : () => handlePdfFileRemove(file.name)}
                />
              ))}
            </Box>
          )}
        </Box>

        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf,.zip"
          onChange={handlePdfFilesChange}
          multiple
          style={{ display: "none" }}
        />

        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            onClick={handleConvert}
            disabled={!schemaFile || pdfFiles.length === 0 || converting}
          >
            {converting ? "Converting..." : "Convert to CSV"}
          </Button>
          {!schemaFile && pdfFiles.length > 0 && (
            <Typography variant="caption" color="textSecondary" sx={{ ml: 2 }}>
              Upload a schema file first
            </Typography>
          )}
        </Box>

        {converting && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant={progress ? "determinate" : "indeterminate"}
              value={progress ? ((progress.index - 1) / progress.total) * 100 : 0}
            />
            {progress && (
              <Typography variant="caption" color="textSecondary">
                Converting {progress.index} of {progress.total}: {progress.file} (this can take a few minutes per file)
              </Typography>
            )}
          </Box>
        )}

        {fileResults.length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            {fileResults.map((r) => (
              <Box key={r.file} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {r.ok ? (
                  <CheckCircleIcon color="success" fontSize="small" />
                ) : (
                  <ErrorOutlineIcon color="error" fontSize="small" />
                )}
                <Typography variant="body2">
                  <strong>{r.file}</strong>
                  {" - "}
                  {r.ok
                    ? `${r.stats.records} record(s), ${r.stats.flagged} value(s) to check, ${r.stats.unmapped} unmapped`
                    : r.message}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {result && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity={
                summary.flagged_values ||
                summary.links_missing ||
                summary.records_dropped ||
                summary.keys_missing ||
                summary.files_failed
                  ? "warning"
                  : "success"
              }
            >
              {recordCount} record(s) in {Object.keys(summary.records_per_class).length} CSV file(s)
              from {summary.files_total - summary.files_failed} of {summary.files_total} PDF(s).
              {summary.flagged_values > 0 &&
                ` ${summary.flagged_values} value(s) are marked CHECK in review.csv.`}
              {summary.links_missing > 0 &&
                ` ${summary.links_missing} empty link(s) are marked CHECK.`}
              {summary.records_dropped > 0 &&
                ` ${summary.records_dropped} record(s) without data of their own were removed.`}
              {summary.keys_missing > 0 &&
                ` ${summary.keys_missing} record(s) have an empty key and will not merge across PDFs.`}
              {summary.links_added > 0 &&
                ` ${summary.links_added} link(s) were filled in automatically (see review.csv).`}
              {summary.images_not_read > 0 &&
                ` ${summary.images_not_read} image(s) could not be read - check them manually.`}
            </Alert>

            {result.summary_pdf_error && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {result.summary_pdf_error}
              </Alert>
            )}

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, flexWrap: "wrap" }}>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleDownloadZip}>
                Download all (ZIP)
              </Button>
              {result.summary_pdf_base64 && (
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadSummary}>
                  Download summary (PDF)
                </Button>
              )}
              {result.files.map((file) => (
                <Chip
                  key={file.name}
                  icon={<DownloadIcon />}
                  label={file.name}
                  variant="outlined"
                  color={file.name === "review.csv" ? "warning" : "default"}
                  onClick={() => handleDownloadFile(file)}
                />
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
