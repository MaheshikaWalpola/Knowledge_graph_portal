import React, { useState, useEffect, useRef, useMemo } from "react";
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
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Collapse,
  LinearProgress
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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

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

  // ── Workspace validation target schemas ──
  const [schemas, setSchemas] = useState([]);
  const [validationTarget, setValidationTarget] = useState("uploaded");

  useEffect(() => {
    if (user) {
      fetchUserSchemas();
    }
  }, [user]);

  const fetchUserSchemas = async () => {
    try {
      const res = await axios.get(`${API}/workspace/schemas`, getAuthConfig());
      if (res.data && res.data.schemas) {
        setSchemas(res.data.schemas);
      }
    } catch (err) {
      console.error("Error fetching schemas", err);
    }
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

  // ── Step 2 ──
  const [shaclCode, setShaclCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [shaclGenerationSteps, setShaclGenerationSteps] = useState([]);

  // ── Step 3 ──
  const [playgroundSchemaText, setPlaygroundSchemaText] = useState("");
  const [playgroundInstancesText, setPlaygroundInstancesText] = useState(SAMPLE_INSTANCES);
  const [playgroundShaclText, setPlaygroundShaclText] = useState("");
  const [playgroundSchemaFullText, setPlaygroundSchemaFullText] = useState("");
  const [playgroundInstancesFullText, setPlaygroundInstancesFullText] = useState("");
  const [playgroundReport, setPlaygroundReport] = useState(null);
  const [expandedRules, setExpandedRules] = useState({});
  const [validationSteps, setValidationSteps] = useState([]);

  // Group violations by source shape for the expandable rule cards
  const violationsByShape = useMemo(() => {
    if (!playgroundReport?.violations) return {};
    const map = {};
    for (const v of playgroundReport.violations) {
      const key = v.source_shape || "unknown";
      if (!map[key]) map[key] = [];
      map[key].push(v);
    }
    return map;
  }, [playgroundReport]);

  const toggleRuleExpand = (shapeIri) => {
    setExpandedRules(prev => ({ ...prev, [shapeIri]: !prev[shapeIri] }));
  };

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
    setSuccess(null);
    setShaclCode("");
    setShaclGenerationSteps(activeRules.map(rule => ({ rule, status: "pending" })));

    // Transition to Step 2 immediately so the user can watch it stream
    setActiveStep(2);

    const formData = new FormData();
    formData.append("rules", JSON.stringify(activeRules));
    if (combinedFile) formData.append("schema_file", combinedFile);
    else if (schemaFile) formData.append("schema_file", schemaFile);

    try {
      const token = localStorage.getItem("token");
      const headers = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(`${API}/validation/generate-shacl-stream`, {
        method: "POST",
        headers,
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Start with initial prefix comments
      setShaclCode(
        `@prefix sh: <http://www.w3.org/ns/shacl#> .\n` +
        `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n` +
        `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n` +
        `@prefix cmpo: <https://tucid/cpmo/> .\n` +
        `@prefix inst: <https://tucid/cpmo/instance/> .\n\n` +
        `# Generating SHACL shapes. Please wait...\n`
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5).trim());

              if (event.status === "start") {
                // Initialize rule statuses to generating
                setShaclGenerationSteps(prev => 
                  prev.map(step => ({ ...step, status: "generating" }))
                );
              } else if (event.status === "progress") {
                // Update rule status
                setShaclGenerationSteps(prev => 
                  prev.map((step, idx) => 
                    idx === event.index 
                      ? { ...step, status: event.result_status } 
                      : step
                  )
                );

                // Append shape snippet if successful
                if (event.result_status === "success" && event.shacl) {
                  setShaclCode(prev => {
                    const separator = prev.endsWith("\n\n") ? "" : prev.endsWith("\n") ? "\n" : "\n\n";
                    let nextVal = prev;
                    if (nextVal.includes("# Generating SHACL shapes.")) {
                      nextVal = nextVal.replace("# Generating SHACL shapes. Please wait...\n", "");
                    }
                    return nextVal + separator + event.shacl + "\n";
                  });
                }
              } else if (event.status === "completed") {
                // Complete generation, overwrite with final formatted version
                if (event.shacl_ttl) {
                  setShaclCode(event.shacl_ttl);
                  setPlaygroundShaclText(event.shacl_ttl);
                }
                setSuccess("SHACL shapes generated successfully!");
              }
            } catch (e) {
              console.error("Failed to parse shape stream chunk", e);
            }
          }
        }
      }
    } catch (err) {
      setError(err.message || "Failed to generate SHACL shapes.");
      setActiveStep(1);
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

  const getDisplayPreview = (text, maxLength = 50000) => {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    const mb = (text.length / (1024 * 1024)).toFixed(2);
    return text.substring(0, maxLength) + `\n\n... [TRUNCATED - File is too large to edit in browser (${mb} MB)]`;
  };

  // ── Step 2 → 3: Proceed ──
  const handleProceedToPlayground = () => {
    try {
      console.log("handleProceedToPlayground clicked", {
        schemaLength: schemaFileText ? schemaFileText.length : 0,
        instanceLength: instanceFileText ? instanceFileText.length : 0,
        shaclLength: shaclCode ? shaclCode.length : 0
      });
      
      // Store full contents
      setPlaygroundSchemaFullText(schemaFileText || "");
      setPlaygroundInstancesFullText(instanceFileText || "");
      
      // Store display previews (to prevent browser crash)
      setPlaygroundSchemaText(getDisplayPreview(schemaFileText || ""));
      setPlaygroundInstancesText(getDisplayPreview(instanceFileText || ""));
      setPlaygroundShaclText(shaclCode || "");
      
      setSuccess(null);
      setError(null);
      setActiveStep(3);
    } catch (err) {
      console.error("Error transitioning to playground step:", err);
      setError("Failed to transition to playground: " + err.message);
    }
  };

  // ── Step 3: Validate (SSE streaming) ──
  const handlePlaygroundValidate = async () => {
    setLoading(true);
    setError(null);
    setPlaygroundReport(null);
    setValidationSteps([]);
    setExpandedRules({});

    const formData = new URLSearchParams();
    formData.append("shacl_ttl", playgroundShaclText);

    let streamUrl;
    if (validationTarget === "uploaded") {
      const activeSchema = playgroundSchemaFullText || playgroundSchemaText;
      const activeInstances = playgroundInstancesFullText || playgroundInstancesText;
      if (!activeSchema) {
        setError("No schema content found. Please upload files in Step 1 or select a workspace schema from the dropdown.");
        setLoading(false);
        return;
      }
      formData.append("schema_ttl", activeSchema);
      formData.append("instances_ttl", activeInstances);
      streamUrl = `${API}/validation/run-playground-stream`;
    } else {
      formData.append("schema_id", validationTarget);
      streamUrl = `${API}/validation/run-workspace-stream`;
    }

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: formData.toString()
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5).trim());

              if (event.error) {
                setError(event.message);
                setValidationSteps(prev => [...prev, { ...event, status: "error" }]);
                setLoading(false);
                return;
              }

              if (event.report) {
                setPlaygroundReport(event.report);
                setValidationSteps(prev => [...prev, { step: "done", message: "Validation complete!", status: "done" }]);
                setSuccess("Validation complete!");
              } else {
                setValidationSteps(prev => [...prev, { ...event, status: "done" }]);
              }
            } catch { /* skip non-JSON lines */ }
          }
        }
      }
    } catch (err) {
      setError(err.message || "An error occurred during validation.");
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


              </Box>
            )}

            {/* ════════ STEP 2: SHACL Shapes ════════ */}
            {activeStep === 2 && (
              <Box>
                {shaclGenerationSteps.length > 0 && (
                  <Card variant="outlined" sx={{ mb: 3, border: "1px solid var(--border-light)", bgcolor: "var(--bg-glass-strong)" }}>
                    <CardContent sx={{ pb: '16px !important' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                        {loading ? "Generating SHACL Shapes..." : "Shape Generation Status"}
                      </Typography>
                      <Stack spacing={1}>
                        {shaclGenerationSteps.map((step, idx) => (
                          <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                            {step.status === "pending" && (
                              <Box sx={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--border-medium)", flexShrink: 0 }} />
                            )}
                            {step.status === "generating" && (
                              <CircularProgress size={18} sx={{ color: "var(--accent-primary)" }} />
                            )}
                            {step.status === "success" && (
                              <CheckCircleIcon sx={{ fontSize: 18, color: "var(--accent-success)", flexShrink: 0 }} />
                            )}
                            {step.status === "error" && (
                              <CancelIcon sx={{ fontSize: 18, color: "var(--accent-error)", flexShrink: 0 }} />
                            )}
                            <Typography variant="body2" color={step.status === "pending" ? "textSecondary" : "textPrimary"}>
                              {step.rule}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
                  <Typography variant="h6">Generated SHACL Shapes</Typography>
                  <button 
                    className={`validation-copy-btn ${copied ? "copied" : ""}`} 
                    onClick={handleCopyShacl}
                    disabled={loading}
                  >
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
                  InputProps={{ 
                    className: "validation-code-area",
                    readOnly: loading 
                  }}
                  sx={{ mb: 2 }}
                />
              </Box>
            )}

            {/* ════════ STEP 3: Validate & Report ════════ */}
            {activeStep === 3 && (
              <Box>
                <Typography variant="h6" gutterBottom>Validation Playground</Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
                  Paste or edit your SHACL shapes, schema, and instance data below. Then run the SHACL validator against the data.
                </Typography>

                {/* SHACL Shapes — Full Width Code Editor */}
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent sx={{ pb: '16px !important' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      SHACL Shapes (.ttl)
                    </Typography>
                    <TextField
                      multiline
                      rows={18}
                      fullWidth
                      variant="outlined"
                      value={playgroundShaclText}
                      onChange={(e) => setPlaygroundShaclText(e.target.value)}
                      InputProps={{ className: "validation-code-area" }}
                    />
                  </CardContent>
                </Card>

                {/* Compact Validation Target Bar */}
                <Box className="validation-target-bar" sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      Validate Against:
                    </Typography>
                    <FormControl variant="outlined" size="small" sx={{ minWidth: 220 }}>
                      <Select
                        value={validationTarget}
                        onChange={(e) => setValidationTarget(e.target.value)}
                        displayEmpty
                      >
                        <MenuItem value="uploaded" disabled={!schemaFile && !instanceFile && !combinedFile}>
                          {schemaFile || instanceFile || combinedFile 
                            ? "Uploaded Files" 
                            : "No Uploaded Files"}
                        </MenuItem>
                        {schemas.map((s) => (
                          <MenuItem key={s.schema_id} value={s.schema_id}>
                            {s.name} ({s.upload_mode})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
                      {validationTarget === "uploaded" 
                        ? `${schemaFile?.name || combinedFile?.name || "—"} ${schemaFileText ? `(${(schemaFileText.length / 1024).toFixed(1)} KB)` : ""}  •  ${instanceFile?.name || combinedFile?.name || "—"} ${instanceFileText ? `(${(instanceFileText.length / (1024 * 1024)).toFixed(2)} MB)` : ""}`
                        : "GraphDB workspace graphs"
                      }
                    </Typography>
                  </Box>
                </Box>

                {/* Live Validation Progress Steps */}
                {(loading || validationSteps.length > 0) && !playgroundReport && (
                  <Card variant="outlined" sx={{ mb: 2 }}>
                    <CardContent sx={{ pb: '16px !important' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                        {loading ? "Validation Progress" : "Validation Status"}
                      </Typography>
                      <Stack spacing={0.75}>
                        {validationSteps.map((step, i) => (
                          <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                            {step.status === "error" 
                              ? <CancelIcon sx={{ fontSize: 18, color: "var(--accent-error)" }} />
                              : step.status === "done" && step.step === "done"
                                ? <CheckCircleIcon sx={{ fontSize: 18, color: "var(--accent-success)" }} />
                                : <CheckCircleIcon sx={{ fontSize: 18, color: "var(--accent-success)", opacity: 0.7 }} />
                            }
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontSize: 13,
                                color: step.status === "error" ? "var(--accent-error)" : "var(--text-secondary)",
                                fontWeight: step.status === "error" ? 600 : 400
                              }}
                            >
                              {step.message}
                            </Typography>
                          </Box>
                        ))}
                        {loading && (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2" sx={{ fontSize: 13, color: "var(--text-secondary)" }}>
                              Processing...
                            </Typography>
                          </Box>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* ── Validation Results ── */}
                {playgroundReport && (
                  <Stack spacing={2.5} sx={{ mt: 2 }}>

                    {/* ── Summary Banner ── */}
                    <Box className={`validation-summary-banner ${playgroundReport.conforms ? "pass" : "fail"}`}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          {playgroundReport.conforms 
                            ? <CheckCircleIcon sx={{ fontSize: 32 }} />
                            : <CancelIcon sx={{ fontSize: 32 }} />
                          }
                          <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                              {playgroundReport.conforms ? "All Shapes Conform" : "Validation Failed"}
                            </Typography>
                            <Typography variant="body2" sx={{ opacity: 0.85 }}>
                              {playgroundReport.conforms 
                                ? "Your data passes all SHACL constraints."
                                : `${playgroundReport.total_violations} violation${playgroundReport.total_violations !== 1 ? "s" : ""} found across ${playgroundReport.rules?.filter(r => r.status !== "Pass").length || 0} rule${(playgroundReport.rules?.filter(r => r.status !== "Pass").length || 0) !== 1 ? "s" : ""}`
                              }
                            </Typography>
                          </Box>
                        </Box>
                        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 2 }}>
                          <Box sx={{ textAlign: "right" }}>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>{playgroundReport.total_triples} triples evaluated</Typography>
                          </Box>
                          <Button 
                            variant="outlined" 
                            size="small"
                            startIcon={<DownloadIcon />} 
                            onClick={() => handleDownloadPDF(playgroundReport)}
                            sx={{ 
                              borderColor: 'rgba(255,255,255,0.4)', 
                              color: 'inherit', 
                              '&:hover': { borderColor: 'rgba(255,255,255,0.7)', bgcolor: 'rgba(255,255,255,0.1)' }
                            }}
                          >
                            PDF Report
                          </Button>
                        </Box>
                      </Box>

                      {/* Progress bar showing pass ratio */}
                      {playgroundReport.rules?.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="caption" sx={{ opacity: 0.8 }}>
                              {playgroundReport.rules.filter(r => r.status === "Pass").length} / {playgroundReport.rules.length} rules passed
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.8 }}>
                              {Math.round((playgroundReport.rules.filter(r => r.status === "Pass").length / playgroundReport.rules.length) * 100)}%
                            </Typography>
                          </Box>
                          <LinearProgress 
                            variant="determinate" 
                            value={(playgroundReport.rules.filter(r => r.status === "Pass").length / playgroundReport.rules.length) * 100}
                            sx={{ 
                              height: 6, 
                              borderRadius: 3, 
                              bgcolor: 'rgba(255,255,255,0.2)',
                              '& .MuiLinearProgress-bar': { 
                                borderRadius: 3,
                                bgcolor: playgroundReport.conforms ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.7)' 
                              }
                            }}
                          />
                        </Box>
                      )}
                    </Box>

                    {/* ── Rules List with Expandable Violations ── */}
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>Rules Evaluated</Typography>
                      <Stack spacing={1}>
                        {playgroundReport.rules?.map((rule, i) => {
                          const ruleViolations = violationsByShape[rule.shape_iri] || [];
                          const isFail = rule.status !== "Pass";
                          const isExpanded = expandedRules[rule.shape_iri];

                          return (
                            <Box key={i} className={`validation-rule-card ${isFail ? "fail" : "pass"}`}>
                              {/* Rule Header Row */}
                              <Box 
                                className="validation-rule-header"
                                onClick={() => isFail && ruleViolations.length > 0 && toggleRuleExpand(rule.shape_iri)}
                                sx={{ cursor: isFail && ruleViolations.length > 0 ? "pointer" : "default" }}
                              >
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
                                  {isFail 
                                    ? <CancelIcon sx={{ fontSize: 20, color: "var(--accent-error)", flexShrink: 0 }} />
                                    : <CheckCircleIcon sx={{ fontSize: 20, color: "var(--accent-success)", flexShrink: 0 }} />
                                  }
                                  <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                                      {rule.label}
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                      {rule.target_class_short}
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                                  {isFail ? (
                                    <Chip 
                                      label={`${ruleViolations.length} violation${ruleViolations.length !== 1 ? "s" : ""}`}
                                      size="small"
                                      sx={{ 
                                        bgcolor: "rgba(239, 68, 68, 0.1)", 
                                        color: "var(--accent-error)", 
                                        fontWeight: 600,
                                        fontSize: 12,
                                        height: 24
                                      }}
                                    />
                                  ) : (
                                    <Chip 
                                      label="Pass" 
                                      size="small"
                                      sx={{ 
                                        bgcolor: "rgba(16, 185, 129, 0.1)", 
                                        color: "var(--accent-success)", 
                                        fontWeight: 600,
                                        fontSize: 12,
                                        height: 24
                                      }}
                                    />
                                  )}
                                  {isFail && ruleViolations.length > 0 && (
                                    isExpanded 
                                      ? <ExpandLessIcon sx={{ fontSize: 20, color: "var(--text-secondary)" }} />
                                      : <ExpandMoreIcon sx={{ fontSize: 20, color: "var(--text-secondary)" }} />
                                  )}
                                </Box>
                              </Box>

                              {/* Expandable Violations */}
                              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                <Box className="validation-rule-violations">
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                                    <WarningAmberIcon sx={{ fontSize: 16, color: "var(--accent-error)" }} />
                                    <Typography variant="caption" sx={{ fontWeight: 600, color: "var(--accent-error)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                      {ruleViolations.length} Violation{ruleViolations.length !== 1 ? "s" : ""} Details
                                    </Typography>
                                  </Box>
                                  <TableContainer sx={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border-light)", overflow: "hidden" }}>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ bgcolor: "var(--bg-tertiary)" }}>
                                          <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Focus Node</TableCell>
                                          <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Property</TableCell>
                                          <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Message</TableCell>
                                          <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Value</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {ruleViolations.map((v, vi) => (
                                          <TableRow key={vi} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                                            <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11, py: 0.75 }}>{v.focus_node_short}</TableCell>
                                            <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11, py: 0.75 }}>{v.path_short}</TableCell>
                                            <TableCell sx={{ fontSize: 12, py: 0.75 }}>{v.message}</TableCell>
                                            <TableCell sx={{ fontSize: 12, py: 0.75, color: "var(--accent-error)" }}>{v.value || "—"}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </Box>
                              </Collapse>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
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
