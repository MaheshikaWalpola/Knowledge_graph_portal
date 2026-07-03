import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Grid,
  Checkbox,
  Alert,
  AlertTitle,
  Tooltip,
  IconButton,
  Card,
  CardContent,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DownloadIcon from "@mui/icons-material/Download";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

import "./ValidationPage.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STEPS = [
  "Define Questions",
  "Finalize Questions",
  "SHACL Shapes",
  "Validate & Report"
];

const SAMPLE_INSTANCES = `@prefix cmpo: <https://tucid/cpmo/> .
@prefix inst: <https://tucid/cpmo/instance/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

inst:CMPProcess_2_100 a cmpo:CMPProcess ;
    rdfs:label "CMP Process 2 (row 100)" ;
    cmpo:actsOn inst:Wafer_2981014422 ;
    cmpo:hasCMPToolComponent inst:Chamber_4 ;
    cmpo:hasTimestamp "1985-05-19T23:01:54.667000"^^xsd:dateTime ;
    cmpo:hasInputParameter inst:Pressure_2_100_CENTER_AIR_BAG_PRESSURE .

inst:Pressure_2_100_CENTER_AIR_BAG_PRESSURE a cmpo:CenterAirBagPressure ;
    rdfs:label "Center Air Bag Pressure 2_100" ;
    cmpo:hasNumericValue "65.9375"^^xsd:float ;
    cmpo:hasUnit "psi" .

inst:Wafer_2981014422 a cmpo:Wafer ;
    rdfs:label "Wafer 2981014422" ;
    cmpo:hasDiameter inst:WaferDiameter_300mm ;
    cmpo:hasMaterial inst:WaferMaterial_Copper .
`;

export default function ValidationPage({ user: propUser, onOpenAuth }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (propUser) {
      setUser(propUser);
    } else {
      const storedUser = localStorage.getItem("kgp_user");
      if (storedUser) {
        try { setUser(JSON.parse(storedUser)); } catch (e) { console.error(e); }
      } else {
        setUser(null);
      }
    }
  }, [propUser]);

  useEffect(() => {
    if (!propUser && !localStorage.getItem("kgp_user")) {
      onOpenAuth?.();
    }
  }, [propUser, onOpenAuth]);

  const getAuthConfig = () => {
    const token = localStorage.getItem("token");
    return { headers: { Authorization: token ? `Bearer ${token}` : "" } };
  };

  // ── Core state ──
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [infoDialog, setInfoDialog] = useState(false);

  // ── Step 0 ──
  const [inputMode, setInputMode] = useState("ai");
  const [schemaFile, setSchemaFile] = useState(null);
  const [instanceFile, setInstanceFile] = useState(null);
  const [combinedFile, setCombinedFile] = useState(null);
  const [schemaFileText, setSchemaFileText] = useState("");
  const [instanceFileText, setInstanceFileText] = useState("");
  const [aiContextPrompt, setAiContextPrompt] = useState("");
  const [manualQuestionsText, setManualQuestionsText] = useState("");

  // ── Step 1 ──
  const [questions, setQuestions] = useState([]);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [moreLoading, setMoreLoading] = useState(false);

  // ── Step 2 ──
  const [shaclCode, setShaclCode] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Step 3 ──
  const [playgroundSchemaText, setPlaygroundSchemaText] = useState("");
  const [playgroundInstancesText, setPlaygroundInstancesText] = useState(SAMPLE_INSTANCES);
  const [playgroundShaclText, setPlaygroundShaclText] = useState("");
  const [playgroundReport, setPlaygroundReport] = useState(null);

  // Refs
  const schemaInputRef = useRef(null);
  const instanceInputRef = useRef(null);
  const combinedInputRef = useRef(null);

  // ── File helpers ──
  const readFileAsText = (file) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsText(file);
    });

  const handleSchemaFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSchemaFile(file);
    setSchemaFileText(await readFileAsText(file));
    if (combinedFile) setCombinedFile(null);
    e.target.value = "";
  };

  const handleInstanceFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInstanceFile(file);
    setInstanceFileText(await readFileAsText(file));
    if (combinedFile) setCombinedFile(null);
    e.target.value = "";
  };

  const handleCombinedFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCombinedFile(file);
    const text = await readFileAsText(file);
    setSchemaFileText(text);
    setInstanceFileText(text);
    setSchemaFile(null);
    setInstanceFile(null);
    e.target.value = "";
  };

  // ── Step 0 → 1: AI generation ──
  const handleGenerateQuestions = async () => {
    setLoading(true);
    setError(null);

    const formData = new FormData();
    if (aiContextPrompt) formData.append("user_explanation", aiContextPrompt);

    if (combinedFile) {
      formData.append("schema_file", combinedFile);
      formData.append("instance_file", combinedFile);
    } else {
      if (schemaFile) formData.append("schema_file", schemaFile);
      if (instanceFile) formData.append("instance_file", instanceFile);
    }

    try {
      const res = await axios.post(`${API}/validation/suggest-rules`, formData, getAuthConfig());
      if (res.data?.rules) {
        setQuestions(res.data.rules.map((r) => ({ text: r, selected: true })));
        setSuccess("AI generated 10 validation questions from your files.");
        setActiveStep(1);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to generate questions. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 0 → 1: Manual submission ──
  const handleManualSubmit = () => {
    const lines = manualQuestionsText.split("\n").map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;
    setQuestions(lines.map((r) => ({ text: r, selected: true })));
    setActiveStep(1);
  };

  // ── Step 1: Ask AI for more ──
  const handleAskForMore = async () => {
    setMoreLoading(true);
    const formData = new FormData();
    formData.append("existing_rules", JSON.stringify(questions.map(q => q.text)));
    if (schemaFileText) formData.append("schema_content", schemaFileText);
    if (instanceFileText) formData.append("instance_content", instanceFileText);

    try {
      const res = await axios.post(`${API}/validation/suggest-more-rules`, formData, getAuthConfig());
      if (res.data?.rules) {
        setQuestions(prev => [...prev, ...res.data.rules.map((r) => ({ text: r, selected: true }))]);
        setSuccess(`AI generated ${res.data.rules.length} additional questions.`);
      }
    } catch (err) {
      setError("Failed to generate more questions.");
    } finally {
      setMoreLoading(false);
    }
  };

  // ── Step 1: question management ──
  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) return;
    setQuestions(prev => [...prev, { text: newQuestionText.trim(), selected: true }]);
    setNewQuestionText("");
  };

  const toggleQuestion = (idx) =>
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, selected: !q.selected } : q));

  const editQuestion = (idx, newText) =>
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, text: newText } : q));

  const deleteQuestion = (idx) =>
    setQuestions(prev => prev.filter((_, i) => i !== idx));

  const selectedCount = questions.filter(q => q.selected).length;

  // ── Step 1 → 2: Generate SHACL ──
  const handleGenerateSHACL = async () => {
    const activeRules = questions.filter(q => q.selected).map(q => q.text);
    if (activeRules.length === 0) {
      setError("Please select at least one question.");
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("rules", JSON.stringify(activeRules));
    if (combinedFile) formData.append("schema_file", combinedFile);
    else if (schemaFile) formData.append("schema_file", schemaFile);

    try {
      const res = await axios.post(`${API}/validation/generate-shacl`, formData, getAuthConfig());
      if (res.data?.shacl_ttl) {
        setShaclCode(res.data.shacl_ttl);
        setPlaygroundShaclText(res.data.shacl_ttl);
        setSuccess("SHACL shapes generated successfully!");
        setActiveStep(2);
      }
    } catch (err) {
      setError("Failed to generate SHACL shapes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Copy ──
  const handleCopyShacl = async () => {
    try {
      await navigator.clipboard.writeText(shaclCode);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shaclCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Step 2 → 3: Proceed ──
  const handleProceedToPlayground = () => {
    if (schemaFileText) setPlaygroundSchemaText(schemaFileText);
    if (instanceFileText && instanceFileText !== schemaFileText) setPlaygroundInstancesText(instanceFileText);
    setPlaygroundShaclText(shaclCode);
    setSuccess(null);
    setActiveStep(3);
  };

  // ── Step 3: Validate ──
  const handlePlaygroundValidate = async () => {
    setLoading(true);
    setError(null);
    setPlaygroundReport(null);

    const formData = new FormData();
    formData.append("schema_ttl", playgroundSchemaText);
    formData.append("instances_ttl", playgroundInstancesText);
    formData.append("shacl_ttl", playgroundShaclText);

    try {
      const res = await axios.post(`${API}/validation/run-playground`, formData, getAuthConfig());
      if (res.data?.report) {
        setPlaygroundReport(res.data.report);
        setSuccess("Validation complete!");
      } else {
        setError("Invalid playground validation report.");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "An error occurred during validation.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Download PDF ──
  const handleDownloadPDF = async (reportData) => {
    if (!reportData) return;
    try {
      const formData = new FormData();
      formData.append("report_data", JSON.stringify(reportData));
      const res = await axios.post(`${API}/validation/export-pdf`, formData, {
        ...getAuthConfig(),
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "validation_report.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("Failed to export PDF report.");
    }
  };

  // ── Back / Reset ──
  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
      setError(null);
      setSuccess(null);
    }
  };

  const handleReset = () => {
    setActiveStep(0);
    setQuestions([]);
    setShaclCode("");
    setPlaygroundReport(null);
    setError(null);
    setSuccess(null);
  };

  // ── Auth gate ──
  if (!user) {
    return (
      <div className="validation-container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
        <Box className="validation-auth-gate">
          <Box className="validation-auth-icon">
            <AutoAwesomeIcon sx={{ fontSize: 40 }} />
          </Box>
          <Typography className="validation-auth-title">Sign In Required</Typography>
          <Typography className="validation-auth-message">
            Please log in to access the AI-powered SHACL Validation tool.
          </Typography>
          <Button variant="contained" onClick={onOpenAuth} sx={{ mt: 2 }}>Sign In</Button>
        </Box>
      </div>
    );
  }

  return (
    <div className="validation-container">
      <div className="validation-card">

        {/* ── Header ── */}
        <div className="validation-header">
          <div className="validation-header-left">
            <h2 className="validation-title">AI-Powered SHACL Validation</h2>
            <p className="validation-subtitle">
              Generate validation questions with AI, compile them into SHACL shapes, and run compliance checks with downloadable reports.
            </p>
          </div>
          <Tooltip title="How it works">
            <IconButton onClick={() => setInfoDialog(true)} size="small" sx={{ color: 'var(--accent-primary)' }}>
              <InfoOutlinedIcon />
            </IconButton>
          </Tooltip>
        </div>

        {/* ── Info Dialog ── */}
        <Dialog open={infoDialog} onClose={() => setInfoDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>How SHACL Validation Works</DialogTitle>
          <DialogContent dividers>
            <ol style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.8 }}>
              <li><strong>Upload files</strong> — Provide your RDF schema (.ttl) and/or instance data, or a combined file. Optionally describe what you want to validate.</li>
              <li><strong>Generate questions</strong> — AI analyzes your files and suggests 10 validation questions in plain English. You can also enter questions manually.</li>
              <li><strong>Finalize & compile</strong> — Edit, add, or remove questions, then compile them into SHACL shapes (Turtle format).</li>
              <li><strong>Validate & report</strong> — Run the SHACL shapes against your data in the built-in playground and download a PDF compliance report.</li>
            </ol>
            <Alert severity="info" sx={{ mt: 2 }}>
              You can copy the generated SHACL shapes and paste them into an external SHACL playground like Zazuko for additional testing.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInfoDialog(false)}>Got it</Button>
          </DialogActions>
        </Dialog>

        <div className="validation-content">

          {/* ── Custom Stepper ── */}
          <div className="validation-stepper">
            <div className="validation-stepper-steps">
              {STEPS.map((label, idx) => (
                <div key={label} className={`validation-stepper-step ${activeStep === idx ? "active" : ""} ${activeStep > idx ? "completed" : ""}`}>
                  <div className="validation-stepper-circle">{idx + 1}</div>
                  <p className="validation-stepper-label">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="validation-body">

            {/* Alerts */}
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                <AlertTitle>Error</AlertTitle>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" onClose={() => setSuccess(null)}>
                <AlertTitle>Success</AlertTitle>
                {success}
              </Alert>
            )}

            {/* ════════ STEP 0: Define Questions ════════ */}
            {activeStep === 0 && (
              <Box>
                <Typography variant="h6" gutterBottom>Define Your Validation Questions</Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
                  Choose how to create your validation questions — let AI generate them from your data files, or enter them manually in plain English.
                </Typography>

                {/* Mode Toggle */}
                <Box className="validation-mode-toggle">
                  <button
                    className={`validation-mode-toggle-btn ${inputMode === "ai" ? "active" : ""}`}
                    onClick={() => setInputMode("ai")}
                  >
                    <AutoAwesomeIcon sx={{ fontSize: 18 }} /> Generate with AI
                  </button>
                  <button
                    className={`validation-mode-toggle-btn ${inputMode === "manual" ? "active" : ""}`}
                    onClick={() => setInputMode("manual")}
                  >
                    <EditIcon sx={{ fontSize: 18 }} /> Enter Manually
                  </button>
                </Box>

                {/* ── AI Mode ── */}
                {inputMode === "ai" && (
                  <Stack spacing={3}>
                    <Grid container spacing={3}>
                      {/* Option A: Separate Files */}
                      <Grid item xs={12} md={6}>
                        <Card variant="outlined" sx={{ height: "100%" }}>
                          <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                            <Box>
                              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Option A: Separate Files</Typography>
                              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                                Upload your schema (ontology) and instance data separately.
                              </Typography>
                            </Box>

                            <Stack spacing={2} sx={{ mt: 1 }}>
                              {/* Schema Upload */}
                              <Box>
                                <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>1. Ontology Schema File (.ttl, .rdf, .owl)</Typography>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mt: 0.5 }}>
                                  <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />} onClick={() => schemaInputRef.current?.click()}>
                                    Choose Schema File
                                  </Button>
                                  {schemaFile && (
                                    <Chip icon={<CheckCircleIcon />} label={schemaFile.name} color="success" variant="outlined" size="small" onDelete={() => { setSchemaFile(null); setSchemaFileText(""); }} />
                                  )}
                                </Box>
                                <input ref={schemaInputRef} type="file" accept=".ttl,.rdf,.owl" onChange={handleSchemaFileChange} style={{ display: "none" }} />
                              </Box>

                              {/* Instance Upload */}
                              <Box>
                                <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>2. Instance Data File (.ttl)</Typography>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mt: 0.5 }}>
                                  <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />} onClick={() => instanceInputRef.current?.click()}>
                                    Choose Instance File
                                  </Button>
                                  {instanceFile && (
                                    <Chip icon={<CheckCircleIcon />} label={instanceFile.name} color="success" variant="outlined" size="small" onDelete={() => { setInstanceFile(null); setInstanceFileText(""); }} />
                                  )}
                                </Box>
                                <input ref={instanceInputRef} type="file" accept=".ttl,.rdf,.owl" onChange={handleInstanceFileChange} style={{ display: "none" }} />
                              </Box>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>

                      {/* Option B: Combined File */}
                      <Grid item xs={12} md={6}>
                        <Card variant="outlined" sx={{ height: "100%" }}>
                          <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                            <Box>
                              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Option B: Combined File</Typography>
                              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                                Upload a single file containing both schema and instance definitions.
                              </Typography>
                            </Box>

                            <Box sx={{ mt: 3, mb: 1 }}>
                              <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>Combined File (.ttl, .rdf, .owl)</Typography>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mt: 0.5 }}>
                                <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />} onClick={() => combinedInputRef.current?.click()}>
                                  Choose Combined File
                                </Button>
                                {combinedFile && (
                                  <Chip icon={<CheckCircleIcon />} label={combinedFile.name} color="success" variant="outlined" size="small" onDelete={() => { setCombinedFile(null); setSchemaFileText(""); setInstanceFileText(""); }} />
                                )}
                              </Box>
                              <input ref={combinedInputRef} type="file" accept=".ttl,.rdf,.owl" onChange={handleCombinedFileChange} style={{ display: "none" }} />
                            </Box>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>

                    {/* Context prompt */}
                    <TextField
                      label="Describe what you want to validate (optional)"
                      multiline
                      rows={3}
                      fullWidth
                      value={aiContextPrompt}
                      onChange={(e) => setAiContextPrompt(e.target.value)}
                      placeholder="e.g. I want to check that all pressure values are positive, every CMP process links to a wafer, rotation speeds are within bounds..."
                    />
                  </Stack>
                )}

                {/* ── Manual Mode ── */}
                {inputMode === "manual" && (
                  <Stack spacing={3}>
                    <TextField
                      label="Enter validation questions (one per line)"
                      multiline
                      rows={8}
                      fullWidth
                      variant="outlined"
                      value={manualQuestionsText}
                      onChange={(e) => setManualQuestionsText(e.target.value)}
                      placeholder={"Every CMP process must have a measurement timestamp\nPressure values must be positive floats\nEvery CMP process must act on at least one Wafer\nSlurry flow rates should not be negative"}
                    />

                    <Alert severity="info">
                      Optionally upload schema/instance files below — they will be used later to generate accurate SHACL shapes from your questions.
                    </Alert>

                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
                          <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => schemaInputRef.current?.click()}>
                            {schemaFile ? `Schema: ${schemaFile.name}` : "Upload Schema (.ttl)"}
                          </Button>
                          <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => instanceInputRef.current?.click()}>
                            {instanceFile ? `Instances: ${instanceFile.name}` : "Upload Instance Data (.ttl)"}
                          </Button>
                        </Box>
                        <input ref={schemaInputRef} type="file" accept=".ttl,.rdf,.owl" onChange={handleSchemaFileChange} style={{ display: "none" }} />
                        <input ref={instanceInputRef} type="file" accept=".ttl,.rdf,.owl" onChange={handleInstanceFileChange} style={{ display: "none" }} />
                      </CardContent>
                    </Card>
                  </Stack>
                )}
              </Box>
            )}

            {/* ════════ STEP 1: Finalize Questions ════════ */}
            {activeStep === 1 && (
              <Box>
                <Typography variant="h6" gutterBottom>Finalize Your Validation Questions</Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                  Review, edit, add, or remove questions. Toggle checkboxes to include/exclude from SHACL generation.
                </Typography>
                <Typography variant="body2" sx={{ mb: 3, fontWeight: 600, color: "var(--accent-primary)" }}>
                  {selectedCount} of {questions.length} questions selected
                </Typography>

                {/* Questions list */}
                <Stack spacing={1.5} sx={{ mb: 3 }}>
                  {questions.map((q, idx) => (
                    <Box key={idx} className="validation-question-item" sx={{ opacity: q.selected ? 1 : 0.55 }}>
                      <Checkbox checked={q.selected} onChange={() => toggleQuestion(idx)} size="small" sx={{ mt: -0.5 }} />
                      <div className="validation-question-number">{idx + 1}</div>
                      <TextField
                        variant="standard"
                        fullWidth
                        value={q.text}
                        onChange={(e) => editQuestion(idx, e.target.value)}
                        InputProps={{ disableUnderline: true }}
                        sx={{ fontSize: 14 }}
                      />
                      <button className="validation-question-delete" onClick={() => deleteQuestion(idx)} title="Remove question">
                        <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                      </button>
                    </Box>
                  ))}
                </Stack>

                {/* Add question */}
                <Box sx={{ display: "flex", gap: 1.5, mb: 3 }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddQuestion(); } }}
                    placeholder="Add a custom validation question..."
                  />
                  <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddQuestion} disabled={!newQuestionText.trim()}>
                    Add
                  </Button>
                </Box>

                {/* Ask AI for more */}
                <Button
                  variant="outlined"
                  startIcon={moreLoading ? <CircularProgress size={18} /> : <AutoAwesomeIcon />}
                  onClick={handleAskForMore}
                  disabled={moreLoading}
                >
                  {moreLoading ? "Generating..." : "Ask AI for 5 More Questions"}
                </Button>
              </Box>
            )}

            {/* ════════ STEP 2: SHACL Shapes ════════ */}
            {activeStep === 2 && (
              <Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
                  <Typography variant="h6">Generated SHACL Shapes</Typography>
                  <button className={`validation-copy-btn ${copied ? "copied" : ""}`} onClick={handleCopyShacl}>
                    {copied ? <><CheckIcon sx={{ fontSize: 16 }} /> Copied!</> : <><ContentCopyIcon sx={{ fontSize: 16 }} /> Copy to Clipboard</>}
                  </button>
                </Box>

                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  AI has compiled your questions into SHACL shapes (Turtle format). You can edit the code, copy it to an external SHACL playground, or proceed to validate in-app.
                </Typography>

                <TextField
                  multiline
                  rows={16}
                  fullWidth
                  variant="outlined"
                  value={shaclCode}
                  onChange={(e) => { setShaclCode(e.target.value); setPlaygroundShaclText(e.target.value); }}
                  InputProps={{ className: "validation-code-area" }}
                  sx={{ mb: 2 }}
                />

                <Alert severity="info">
                  <strong>Tip:</strong> Copy the SHACL shapes above and paste them into{" "}
                  <a href="https://shacl-playground.zazuko.com/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>SHACL Playground (Zazuko)</a>
                  {" "}for external testing.
                </Alert>
              </Box>
            )}

            {/* ════════ STEP 3: Validate & Report ════════ */}
            {activeStep === 3 && (
              <Box>
                <Typography variant="h6" gutterBottom>Validation Playground</Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
                  Paste or edit your SHACL shapes, schema, and instance data below. Then run the SHACL validator against the data.
                </Typography>

                <Grid container spacing={2} sx={{ mb: 3 }}>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>SHACL Shapes (.ttl)</Typography>
                        <TextField
                          multiline rows={12} fullWidth variant="outlined"
                          value={playgroundShaclText}
                          onChange={(e) => setPlaygroundShaclText(e.target.value)}
                          InputProps={{ className: "validation-code-area" }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Ontology Schema (.ttl)</Typography>
                        <TextField
                          multiline rows={12} fullWidth variant="outlined"
                          placeholder="# Paste or upload schema TTL code..."
                          value={playgroundSchemaText}
                          onChange={(e) => setPlaygroundSchemaText(e.target.value)}
                          InputProps={{ className: "validation-code-area" }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Instance Data (.ttl)</Typography>
                        <TextField
                          multiline rows={12} fullWidth variant="outlined"
                          value={playgroundInstancesText}
                          onChange={(e) => setPlaygroundInstancesText(e.target.value)}
                          InputProps={{ className: "validation-code-area" }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Validation Results */}
                {loading && (
                  <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", py: 4 }}>
                    <CircularProgress size={40} sx={{ mb: 2 }} />
                    <Typography color="textSecondary">Running SHACL validator with RDFS inference...</Typography>
                  </Box>
                )}

                {playgroundReport && (
                  <Stack spacing={3} sx={{ mt: 2 }}>
                    {/* Summary */}
                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
                          <Box>
                            <Typography variant="subtitle2" color="textSecondary">VALIDATION STATUS</Typography>
                            <Box sx={{ mt: 0.5 }}>
                              {playgroundReport.conforms ? (
                                <span className="validation-status-badge pass"><CheckCircleIcon sx={{ fontSize: 20 }} /> CONFORMS</span>
                              ) : (
                                <span className="validation-status-badge fail"><CancelIcon sx={{ fontSize: 20 }} /> FAILED</span>
                              )}
                            </Box>
                          </Box>
                          <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
                            <Box>
                              <Typography variant="body2">Violations: <b>{playgroundReport.total_violations}</b></Typography>
                              <Typography variant="body2">Triples: <b>{playgroundReport.total_triples}</b></Typography>
                            </Box>
                            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleDownloadPDF(playgroundReport)}>
                              Download PDF
                            </Button>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>

                    {/* Rules Table */}
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Rules Evaluated</Typography>
                        <TableContainer className="validation-table-container">
                          <Table size="small">
                            <TableHead className="validation-table-head">
                              <TableRow>
                                <TableCell className="validation-table-cell-header">Rule/Shape</TableCell>
                                <TableCell className="validation-table-cell-header">Target Class</TableCell>
                                <TableCell className="validation-table-cell-header" align="center">Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {playgroundReport.rules?.map((r, i) => (
                                <TableRow key={i} className="validation-table-row">
                                  <TableCell className="validation-table-cell">{r.label}</TableCell>
                                  <TableCell className="validation-table-cell">{r.target_class_short}</TableCell>
                                  <TableCell className="validation-table-cell" align="center">
                                    {r.status === "Pass"
                                      ? <Box sx={{ color: "var(--accent-success)", fontWeight: 700 }}>Pass</Box>
                                      : <Box sx={{ color: "var(--accent-error)", fontWeight: 700 }}>Fail</Box>
                                    }
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </CardContent>
                    </Card>

                    {/* Violations Table */}
                    {playgroundReport.violations?.length > 0 && (
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2, color: "var(--accent-error)" }}>Violations Log</Typography>
                          <TableContainer className="validation-table-container">
                            <Table size="small">
                              <TableHead className="validation-table-head">
                                <TableRow>
                                  <TableCell className="validation-table-cell-header">Focus Node</TableCell>
                                  <TableCell className="validation-table-cell-header">Property Path</TableCell>
                                  <TableCell className="validation-table-cell-header">Message</TableCell>
                                  <TableCell className="validation-table-cell-header">Value</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {playgroundReport.violations.map((v, i) => (
                                  <TableRow key={i} className="validation-table-row">
                                    <TableCell className="validation-table-cell validation-table-cell-mono">{v.focus_node_short}</TableCell>
                                    <TableCell className="validation-table-cell validation-table-cell-mono">{v.path_short}</TableCell>
                                    <TableCell className="validation-table-cell">{v.message}</TableCell>
                                    <TableCell className="validation-table-cell">{v.value}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>
                    )}
                  </Stack>
                )}
              </Box>
            )}
          </div>

          {/* ── Footer Actions (same as instance-gen-actions) ── */}
          <Box className="validation-actions">
            <Button disabled={activeStep === 0 || loading} onClick={handleBack} variant="outlined">
              Back
            </Button>

            {activeStep === 0 && inputMode === "ai" && (
              <Button
                variant="contained"
                onClick={handleGenerateQuestions}
                disabled={loading || (!schemaFile && !instanceFile && !combinedFile)}
              >
                {loading ? <CircularProgress size={24} /> : "Generate Questions"}
              </Button>
            )}

            {activeStep === 0 && inputMode === "manual" && (
              <Button variant="contained" onClick={handleManualSubmit} disabled={!manualQuestionsText.trim()}>
                Proceed with Questions
              </Button>
            )}

            {activeStep === 1 && (
              <Button variant="contained" onClick={handleGenerateSHACL} disabled={loading || selectedCount === 0}>
                {loading ? <CircularProgress size={24} /> : `Generate SHACL (${selectedCount} questions)`}
              </Button>
            )}

            {activeStep === 2 && (
              <Button variant="contained" onClick={handleProceedToPlayground}>
                Proceed to Playground
              </Button>
            )}

            {activeStep === 3 && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="outlined" onClick={handleReset}>Start Over</Button>
                <Button variant="contained" onClick={handlePlaygroundValidate} disabled={loading} startIcon={loading ? <CircularProgress size={20} /> : <PlayArrowIcon />}>
                  Run Validation
                </Button>
              </Box>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
