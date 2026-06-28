import React, { useState } from "react";
import {
  Button,
  Box,
  Alert,
  AlertTitle,
  CircularProgress,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import axios from "axios";
import "./InstanceGenerationWorkflow.css";

const API = import.meta.env.VITE_API_URL;

import FileUploadStep from "./InstanceGen/FileUploadStep";
import AnalysisReportStep from "./InstanceGen/AnalysisReportStep";
import MatchingReviewStep from "./InstanceGen/MatchingReviewStep";
import GenerationStep from "./InstanceGen/GenerationStep";

const STEPS = [
  "Upload Files",
  "Analysis Report",
  "Review & Correct",
  "Generate Instance",
];

export default function InstanceGenerationWorkflow() {
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // File uploads
  const [schemaFile, setSchemaFile] = useState(null);
  const [dataFiles, setDataFiles] = useState([]);

  // Analysis data
  const [analysisReport, setAnalysisReport] = useState(null);

  // User corrections
  const [userMappings, setUserMappings] = useState({});

  // Generated instance
  const [generatedInstance, setGeneratedInstance] = useState(null);

  // Skip review dialog
  const [skipReviewDialog, setSkipReviewDialog] = useState(false);
  const [infoDialog, setInfoDialog] = useState(false);

  const token = localStorage.getItem("token");

  console.log("InstanceGenerationWorkflow rendered", { activeStep, schemaFile, dataFiles: dataFiles.length });

  // ============ FILE UPLOAD HANDLERS ============
  const handleSchemaUpload = (file) => {
    setSchemaFile(file);
    setError(null);
  };

  const handleDataFilesUpload = (files) => {
    setDataFiles(files);
    setError(null);
  };

  const handleSchemaRemove = () => {
    setSchemaFile(null);
  };

  const handleDataFileRemove = (fileName) => {
    setDataFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  // ============ ANALYSIS STEP ============
  const handleAnalyzeFiles = async () => {
    if (!schemaFile || dataFiles.length === 0) {
      setError("Please upload both schema file and data files");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    // Reset report state so it updates progressively
    setAnalysisReport({
      matched_headers: {},
      unmatched_data_headers: [],
      missing_schema_terms: [],
      available_schema_terms: [],
      matching_method: "Initializing...",
      success: false,
      schema_terms_count: 0,
      data_headers_count: 0,
    });
    setUserMappings({});

    // Transition to step 1 immediately to see progressive results
    setActiveStep(1);

    try {
      const formData = new FormData();
      formData.append("schema_file", schemaFile);
      dataFiles.forEach((file) => {
        formData.append("data_files", file);
      });

      const response = await fetch(`${API}/instance-generation/analyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errMsg = `Failed to analyze files (Status: ${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.detail) errMsg = errData.detail;
        } catch (_) {}
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
          try {
            const data = JSON.parse(line);

            if (data.type === "error") {
              throw new Error(data.message || "An error occurred during analysis.");
            } else if (data.type === "init") {
              setAnalysisReport((prev) => ({
                ...prev,
                available_schema_terms: data.schema_terms,
                missing_schema_terms: data.schema_terms,
                schema_terms_count: data.schema_terms_count,
                data_headers_count: data.data_headers_count,
              }));
            } else if (data.type === "status") {
              setAnalysisReport((prev) => ({
                ...prev,
                matching_method: data.method || prev.matching_method,
              }));
            } else if (data.type === "match") {
              setAnalysisReport((prev) => {
                const nextMatched = { ...prev.matched_headers, [data.header]: data.term };
                const nextMissing = prev.missing_schema_terms.filter((t) => t !== data.term);
                return {
                  ...prev,
                  matched_headers: nextMatched,
                  missing_schema_terms: nextMissing,
                  matching_method: data.method || prev.matching_method,
                };
              });
              setUserMappings((prev) => ({
                ...prev,
                [data.header]: data.term,
              }));
            } else if (data.type === "unmatched") {
              setAnalysisReport((prev) => {
                if (prev.unmatched_data_headers.includes(data.header)) return prev;
                return {
                  ...prev,
                  unmatched_data_headers: [...prev.unmatched_data_headers, data.header],
                };
              });
            } else if (data.type === "done") {
              setAnalysisReport((prev) => ({
                ...prev,
                matched_headers: data.matched_headers || prev.matched_headers,
                unmatched_data_headers: data.unmatched_data_headers || prev.unmatched_data_headers,
                missing_schema_terms: data.missing_schema_terms || prev.missing_schema_terms,
                matching_method: data.matching_method || prev.matching_method,
                success: true,
              }));
              setUserMappings(data.matched_headers || {});
              setSuccess("Analysis complete! Review the matched and unmatched terms.");
            }
          } catch (e) {
            console.error("Failed to parse JSON line from stream", e, line);
            if (e.message && !e.message.includes("JSON")) {
              throw e;
            }
          }
        }
      }
    } catch (err) {
      setError(err.message || "Failed to analyze files");
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };

  // ============ SKIP REVIEW & GENERATE ============
  const handleSkipReviewAndGenerate = async () => {
    setSkipReviewDialog(true);
  };

  const confirmSkipReviewAndGenerate = async () => {
    setSkipReviewDialog(false);
    await generateInstance(userMappings);
  };

  // ============ PROCEED TO REVIEW ============
  const handleProceedToReview = () => {
    setActiveStep(2);
    setSuccess(null);
  };

  // ============ UPDATE MAPPINGS ============
  const handleUpdateMapping = (dataHeader, schemaTerm) => {
    setUserMappings((prev) => ({
      ...prev,
      [dataHeader]: schemaTerm,
    }));
    setError(null);
  };

  const handleRemoveMapping = (dataHeader) => {
    setUserMappings((prev) => {
      const updated = { ...prev };
      delete updated[dataHeader];
      return updated;
    });
  };

  // ============ PROCEED TO GENERATION ============
  const handleProceedToGeneration = () => {
    setActiveStep(3);
    setSuccess(null);
  };

  // ============ GENERATE INSTANCE ============
  const generateInstance = async (mappings) => {
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("schema_file", schemaFile);
      dataFiles.forEach((file) => {
        formData.append("data_files", file);
      });
      formData.append("mappings", JSON.stringify(mappings));

      const response = await axios.post(
        `${API}/instance-generation/generate`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setGeneratedInstance(response.data);
      setActiveStep(3);
      setSuccess("Instance file generated successfully!");
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Failed to generate instance"
      );
    } finally {
      setLoading(false);
    }
  };

  // ============ DOWNLOAD GENERATED FILE ============
  const handleDownloadInstance = () => {
    if (!generatedInstance?.content) return;

    const element = document.createElement("a");
    const file = new Blob([generatedInstance.content], {
      type: "text/turtle",
    });
    element.href = URL.createObjectURL(file);
    element.download = generatedInstance.filename || "instance.ttl";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // ============ RESET WORKFLOW ============
  const handleReset = () => {
    setActiveStep(0);
    setSchemaFile(null);
    setDataFiles([]);
    setAnalysisReport(null);
    setUserMappings({});
    setGeneratedInstance(null);
    setError(null);
    setSuccess(null);
  };

  // ============ BACK BUTTON ============
  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
      setError(null);
      setSuccess(null);
    }
  };

  return (
    <div className="instance-gen-container">
      <div className="instance-gen-card">
        {/* Header */}
        <div className="instance-gen-header">
          <div className="instance-gen-header-left">
            <h2 className="instance-gen-title">Instance Generation Automation</h2>
            <p className="instance-gen-subtitle">Upload schema and data files, review matches, and generate RDF instances</p>
          </div>
          <Tooltip title="How it works">
            <IconButton onClick={() => setInfoDialog(true)} size="small" sx={{ color: 'var(--primary-color, #1976d2)' }}>
              <InfoOutlinedIcon />
            </IconButton>
          </Tooltip>
        </div>

        {/* INFO DIALOG */}
        <Dialog open={infoDialog} onClose={() => setInfoDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>How Instance Generation Works</DialogTitle>
          <DialogContent dividers>
            <ol style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.8 }}>
              <li><strong>Upload files</strong> — Provide your RDF schema (.ttl, .rdf, .owl) and one or more CSV data files.</li>
              <li><strong>Analyze</strong> — The system reads CSV headers and matches them against terms defined in your schema.</li>
              <li><strong>Review matches</strong> — You get a report of matched and unmatched headers. You can correct or reassign any mismatches.</li>
              <li><strong>Generate</strong> — Once you're satisfied, generate an RDF instance file and download it.</li>
            </ol>
            <Alert severity="info" sx={{ mt: 2 }}>
              You can skip the manual review step if you're happy with the automatic matches.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInfoDialog(false)}>Got it</Button>
          </DialogActions>
        </Dialog>

        <div className="instance-gen-content">
          {/* STEPPER */}
          <div className="instance-gen-stepper">
            <div className="stepper-steps">
              {STEPS.map((label, idx) => (
                <div key={label} className={`stepper-step ${activeStep === idx ? "active" : ""} ${activeStep > idx ? "completed" : ""}`}>
                  <div className="stepper-circle">{idx + 1}</div>
                  <p className="stepper-label">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="instance-gen-body">
            {/* ERROR ALERT */}
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                <AlertTitle>Error</AlertTitle>
                {error}
              </Alert>
            )}

            {/* SUCCESS ALERT */}
            {success && (
              <Alert severity="success" onClose={() => setSuccess(null)}>
                <AlertTitle>Success</AlertTitle>
                {success}
              </Alert>
            )}

            {/* STEP 0: FILE UPLOAD */}
            {activeStep === 0 && (
              <FileUploadStep
                onSchemaUpload={handleSchemaUpload}
                onDataFilesUpload={handleDataFilesUpload}
                schemaFile={schemaFile}
                dataFiles={dataFiles}
                onSchemaRemove={handleSchemaRemove}
                onDataFileRemove={handleDataFileRemove}
              />
            )}

            {/* STEP 1: ANALYSIS REPORT */}
            {activeStep === 1 && analysisReport && (
              <AnalysisReportStep
                report={analysisReport}
                onProceedToReview={handleProceedToReview}
                onSkipReviewAndGenerate={handleSkipReviewAndGenerate}
                loading={loading}
              />
            )}

            {/* STEP 2: MATCHING REVIEW & CORRECTION */}
            {activeStep === 2 && analysisReport && (
              <MatchingReviewStep
                analysisReport={analysisReport}
                userMappings={userMappings}
                onUpdateMapping={handleUpdateMapping}
                onRemoveMapping={handleRemoveMapping}
                onProceedToGeneration={handleProceedToGeneration}
                loading={loading}
              />
            )}

            {/* STEP 3: GENERATION & DOWNLOAD */}
            {activeStep === 3 && (
              <GenerationStep
                generatedInstance={generatedInstance}
                onDownload={handleDownloadInstance}
                loading={loading}
                onGenerateAgain={() => generateInstance(userMappings)}
              />
            )}
          </div>

          {/* FOOTER BUTTONS */}
          <Box className="instance-gen-actions">
            <Button
              disabled={activeStep === 0 || loading}
              onClick={handleBack}
              variant="outlined"
            >
              Back
            </Button>

            {activeStep === 0 && (
              <Button
                variant="contained"
                onClick={handleAnalyzeFiles}
                disabled={!schemaFile || dataFiles.length === 0 || loading}
              >
                {loading ? <CircularProgress size={24} /> : "Analyze Files"}
              </Button>
            )}

            {activeStep === 1 && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Tooltip title="Skip detailed review and generate instance directly">
                  <Button
                    variant="outlined"
                    onClick={handleSkipReviewAndGenerate}
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={24} /> : "Skip Review"}
                  </Button>
                </Tooltip>
                <Button
                  variant="contained"
                  onClick={handleProceedToReview}
                  disabled={loading}
                >
                  Review Matches
                </Button>
              </Box>
            )}

            {activeStep === 2 && (
              <Button
                variant="contained"
                onClick={() => generateInstance(userMappings)}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : "Generate Instance"}
              </Button>
            )}

            {activeStep === 3 && generatedInstance && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="outlined"
                  onClick={handleReset}
                  disabled={loading}
                >
                  Start Over
                </Button>
              </Box>
            )}
          </Box>
        </div>
      </div>

      {/* SKIP REVIEW CONFIRMATION DIALOG */}
      <Dialog open={skipReviewDialog} onClose={() => setSkipReviewDialog(false)}>
        <DialogTitle>Skip Manual Review?</DialogTitle>
        <DialogContent>
          <p>
            Are you sure you want to skip the manual review step? The system will
            use the automatically matched headers to generate the instance file.
          </p>
          <Alert severity="info">
            Only matched headers will be used. Missing or unmatched headers will be
            ignored.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipReviewDialog(false)}>Cancel</Button>
          <Button
            onClick={confirmSkipReviewAndGenerate}
            variant="contained"
            color="warning"
          >
            Skip & Generate
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
