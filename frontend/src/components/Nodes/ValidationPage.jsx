import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
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
  Card,
  CardContent,
  Stepper,
  Step,
  StepLabel,
  Alert
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DownloadIcon from "@mui/icons-material/Download";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import RefreshIcon from "@mui/icons-material/Refresh";

import "./ValidationPage.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const DEFAULT_SHACL_TEMPLATE = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://tucid/cpmo/> .
@prefix inst: <https://tucid/cpmo/instance/> .

# Default validation shapes for CMP parameters
cmpo:PressureShape a sh:NodeShape ;
    sh:targetClass cmpo:Pressure ;
    rdfs:label "Pressure Parameter Validation" ;
    sh:property [
        sh:path cmpo:hasNumericValue ;
        sh:minCount 1 ;
        sh:datatype xsd:float ;
        sh:minInclusive 0.0 ;
        sh:message "Pressure parameter value must be a positive float." ;
    ] ;
    sh:property [
        sh:path cmpo:hasUnit ;
        sh:hasValue "psi" ;
        sh:message "Pressure values must be measured in 'psi' units." ;
    ] .

cmpo:CMPProcessShape a sh:NodeShape ;
    sh:targetClass cmpo:CMPProcess ;
    rdfs:label "CMP Process Run Validation" ;
    sh:property [
        sh:path cmpo:hasTimestamp ;
        sh:minCount 1 ;
        sh:datatype xsd:dateTime ;
        sh:message "Every CMP Process run must have a valid measurement timestamp (xsd:dateTime)." ;
    ] ;
    sh:property [
        sh:path cmpo:actsOn ;
        sh:minCount 1 ;
        sh:message "Every CMP Process must act on at least one Wafer." ;
    ] .
`;

const SAMPLE_INSTANCES_TEMPLATE = `@prefix cmpo: <https://tucid/cpmo/> .
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
  const [activeTab, setActiveTab] = useState(0);
  const [user, setUser] = useState(null);

  // Sync user with propUser, fallback to localStorage
  useEffect(() => {
    if (propUser) {
      setUser(propUser);
    } else {
      const storedUser = localStorage.getItem("kgp_user");
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          console.error(e);
        }
      } else {
        setUser(null);
      }
    }
  }, [propUser]);

  // Open login dialog automatically if not authenticated
  useEffect(() => {
    if (!propUser && !localStorage.getItem("kgp_user")) {
      onOpenAuth?.();
    }
  }, [propUser, onOpenAuth]);

  const getAuthConfig = () => {
    const token = localStorage.getItem("token");
    return {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    };
  };

  // --- TAB 0: Workspace Validation States ---
  const [schemas, setSchemas] = useState([]);
  const [selectedSchema, setSelectedSchema] = useState("");
  const [shaclShapes, setShaclShapes] = useState(DEFAULT_SHACL_TEMPLATE);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceReport, setWorkspaceReport] = useState(null);
  const [workspaceError, setWorkspaceError] = useState("");

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
        if (res.data.schemas.length > 0) {
          setSelectedSchema(res.data.schemas[0].schema_id);
        }
      }
    } catch (err) {
      console.error("Error fetching schemas", err);
    }
  };

  const handleWorkspaceValidate = async () => {
    if (!selectedSchema) return;
    setWorkspaceLoading(true);
    setWorkspaceError("");
    setWorkspaceReport(null);

    const formData = new FormData();
    formData.append("schema_id", selectedSchema);
    formData.append("shacl_ttl", shaclShapes);

    try {
      const res = await axios.post(`${API}/validation/run-workspace`, formData, getAuthConfig());
      if (res.data && res.data.report) {
        setWorkspaceReport(res.data.report);
      } else {
        setWorkspaceError("Invalid response format from server.");
      }
    } catch (err) {
      console.error(err);
      setWorkspaceError(
        err.response?.data?.detail || "An error occurred while validating the workspace."
      );
    } finally {
      setWorkspaceLoading(false);
    }
  };

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
    } catch (err) {
      console.error("Error downloading PDF", err);
      alert("Failed to export PDF report.");
    }
  };

  // --- TAB 1: AI Assistant & Playground States ---
  const [step, setStep] = useState(0);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [playgroundSchemaFile, setPlaygroundSchemaFile] = useState(null);
  const [playgroundSchemaName, setPlaygroundSchemaName] = useState("");
  
  const [suggestedRules, setSuggestedRules] = useState([]);
  const [selectedRules, setSelectedRules] = useState({});
  const [customRules, setCustomRules] = useState("");

  const [compiledSHACL, setCompiledSHACL] = useState("");

  const [playgroundSchemaText, setPlaygroundSchemaText] = useState("");
  const [playgroundInstancesText, setPlaygroundInstancesText] = useState(SAMPLE_INSTANCES_TEMPLATE);
  const [playgroundShaclText, setPlaygroundShaclText] = useState("");
  
  const [playgroundReport, setPlaygroundReport] = useState(null);
  const [playgroundError, setPlaygroundError] = useState("");

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPlaygroundSchemaFile(file);
      setPlaygroundSchemaName(file.name);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        setPlaygroundSchemaText(event.target.result);
      };
      reader.readAsText(file);
    }
  };

  const handleSuggestRules = async () => {
    setAssistantLoading(true);
    setPlaygroundError("");
    const formData = new FormData();
    if (explanation) formData.append("user_explanation", explanation);
    if (playgroundSchemaFile) {
      formData.append("schema_file", playgroundSchemaFile);
    } else if (selectedSchema) {
      formData.append("schema_id", selectedSchema);
    }

    try {
      const res = await axios.post(`${API}/validation/suggest-rules`, formData, getAuthConfig());
      if (res.data && res.data.rules) {
        setSuggestedRules(res.data.rules);
        const ruleChecks = {};
        res.data.rules.forEach((_, idx) => {
          ruleChecks[idx] = true;
        });
        setSelectedRules(ruleChecks);
        setStep(1);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to suggest validation rules. Please check connection.");
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleCompileSHACL = async () => {
    setAssistantLoading(true);
    const activeRules = suggestedRules.filter((_, idx) => selectedRules[idx]);
    if (customRules) {
      const lines = customRules.split("\n").filter(l => l.trim() !== "");
      activeRules.push(...lines);
    }

    if (activeRules.length === 0) {
      alert("Please select or add at least one validation rule.");
      setAssistantLoading(false);
      return;
    }

    const formData = new FormData();
    formData.append("rules", JSON.stringify(activeRules));
    if (playgroundSchemaFile) {
      formData.append("schema_file", playgroundSchemaFile);
    } else if (selectedSchema) {
      formData.append("schema_id", selectedSchema);
    }

    try {
      const res = await axios.post(`${API}/validation/generate-shacl`, formData, getAuthConfig());
      if (res.data && res.data.shacl_ttl) {
        setCompiledSHACL(res.data.shacl_ttl);
        setPlaygroundShaclText(res.data.shacl_ttl);
        setStep(2);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to generate SHACL shapes.");
    } finally {
      setAssistantLoading(false);
    }
  };

  const handlePlaygroundValidate = async () => {
    setAssistantLoading(true);
    setPlaygroundError("");
    setPlaygroundReport(null);

    const formData = new FormData();
    formData.append("schema_ttl", playgroundSchemaText);
    formData.append("instances_ttl", playgroundInstancesText);
    formData.append("shacl_ttl", playgroundShaclText);

    try {
      const res = await axios.post(`${API}/validation/run-playground`, formData, getAuthConfig());
      if (res.data && res.data.report) {
        setPlaygroundReport(res.data.report);
      } else {
        setPlaygroundError("Invalid playground validation report.");
      }
    } catch (err) {
      console.error(err);
      setPlaygroundError(
        err.response?.data?.detail || "An error occurred during playground validation."
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  if (!user) {
    return (
      <Box className="validation-workspace" sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
        <Box className="validation-auth-gate">
          <Box className="validation-auth-icon">
            <AutoAwesomeIcon sx={{ fontSize: 40 }} />
          </Box>
          <Typography className="validation-auth-title">
            Sign In Required
          </Typography>
          <Typography className="validation-auth-message">
            Please log in to access the Graph Validation tab and validation playground options.
          </Typography>
          <Button
            variant="contained"
            className="validation-primary-btn"
            onClick={onOpenAuth}
            sx={{ mt: 2 }}
          >
            Sign In
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="validation-workspace">
      {/* Title */}
      <Box className="validation-header">
        <Typography className="validation-title">
          Data Quality Validation
        </Typography>
        <Typography className="validation-subtitle">
          Validate your RDF datasets against SHACL shapes rules, compile rules using AI, and export PDF compliance reports.
        </Typography>
      </Box>

      {/* Tabs Header */}
      <Box className="validation-tabs-container">
        <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)} textColor="primary" indicatorColor="primary">
          <Tab label="Workspace Validator" sx={{ textTransform: "none", fontWeight: 600 }} />
          <Tab label="Interactive AI Assistant & Playground" sx={{ textTransform: "none", fontWeight: 600 }} />
        </Tabs>
      </Box>

      {/* --- TAB 0: Workspace Validator --- */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Config column */}
          <Grid item xs={12} md={5}>
            <Box className="validation-card">
              <Typography className="validation-card-title">
                Configure Validation Run
              </Typography>
              
              <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel id="workspace-schema-select-label">Select Workspace Schema</InputLabel>
                <Select
                  labelId="workspace-schema-select-label"
                  value={selectedSchema}
                  label="Select Workspace Schema"
                  onChange={(e) => setSelectedSchema(e.target.value)}
                >
                  {schemas.map((s) => (
                    <MenuItem key={s.schema_id} value={s.schema_id}>
                      {s.name} ({s.upload_mode})
                    </MenuItem>
                  ))}
                  {schemas.length === 0 && (
                    <MenuItem disabled value="">
                      No workspaces initialized
                    </MenuItem>
                  )}
                </Select>
              </FormControl>

              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                SHACL Validation Shapes (Turtle format)
              </Typography>
              <TextField
                multiline
                rows={12}
                fullWidth
                variant="outlined"
                value={shaclShapes}
                onChange={(e) => setShaclShapes(e.target.value)}
                InputProps={{ className: "validation-code-area" }}
                sx={{ mb: 3 }}
              />

              <Button
                variant="contained"
                className="validation-primary-btn"
                startIcon={workspaceLoading ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
                disabled={workspaceLoading || !selectedSchema}
                onClick={handleWorkspaceValidate}
                fullWidth
              >
                Validate Active Workspace
              </Button>

              {workspaceError && (
                <Alert severity="error" sx={{ mt: 2, borderRadius: "8px" }}>
                  {workspaceError}
                </Alert>
              )}
            </Box>
          </Grid>

          {/* Report column */}
          <Grid item xs={12} md={7}>
            {workspaceLoading ? (
              <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "50vh" }}>
                <CircularProgress size={45} color="primary" sx={{ mb: 2 }} />
                <Typography color="text.secondary">Running SHACL validator with RDFS inference...</Typography>
              </Box>
            ) : workspaceReport ? (
              <Box>
                {/* Result header card */}
                <Box className="validation-card" sx={{ mb: 3 }}>
                  <Box className="validation-results-summary">
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">
                        VALIDATION STATUS
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", mt: 0.5 }}>
                        {workspaceReport.conforms ? (
                          <Box className="validation-status-badge pass">
                            <CheckCircleIcon sx={{ fontSize: 20 }} /> CONFORMS
                          </Box>
                        ) : (
                          <Box className="validation-status-badge fail">
                            <CancelIcon sx={{ fontSize: 20 }} /> FAILED
                          </Box>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Violations: <b>{workspaceReport.total_violations}</b>
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Triples: <b>{workspaceReport.total_triples}</b>
                        </Typography>
                      </Box>
                      <Button
                        variant="outlined"
                        className="validation-secondary-btn"
                        startIcon={<DownloadIcon />}
                        onClick={() => handleDownloadPDF(workspaceReport)}
                        sx={{ height: "40px !important" }}
                      >
                        Download PDF Report
                      </Button>
                    </Box>
                  </Box>
                </Box>

                {/* Rules Table */}
                <Box className="validation-card" sx={{ mb: 3 }}>
                  <Typography className="validation-card-title">
                    Rules Evaluated
                  </Typography>
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
                        {workspaceReport.rules?.map((r, i) => (
                          <TableRow key={i} className="validation-table-row">
                            <TableCell className="validation-table-cell">{r.label}</TableCell>
                            <TableCell className="validation-table-cell">{r.target_class_short}</TableCell>
                            <TableCell className="validation-table-cell" align="center">
                              {r.status === "Pass" ? (
                                <Box sx={{ color: "var(--accent-success)", fontWeight: 700 }}>Pass</Box>
                              ) : (
                                <Box sx={{ color: "var(--accent-error)", fontWeight: 700 }}>Fail</Box>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>

                {/* Violations Table */}
                {workspaceReport.violations && workspaceReport.violations.length > 0 && (
                  <Box className="validation-card">
                    <Typography className="validation-card-title" sx={{ color: "var(--accent-error) !important" }}>
                      Violations Log
                    </Typography>
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
                          {workspaceReport.violations.map((v, i) => (
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
                  </Box>
                )}
              </Box>
            ) : (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh", border: "2px dashed var(--border-medium)", borderRadius: "var(--radius-xl)", backgroundColor: "var(--bg-secondary)" }}>
                <Typography color="text.secondary" sx={{ textAlign: "center", p: 3 }}>
                  Select a workspace schema and click "Validate Active Workspace" to view validation results.
                </Typography>
              </Box>
            )}
          </Grid>
        </Grid>
      )}

      {/* --- TAB 1: Interactive AI Assistant & Playground --- */}
      {activeTab === 1 && (
        <Box>
          <Stepper activeStep={step} className="validation-stepper">
            <Step><StepLabel>Rule Criteria (AI)</StepLabel></Step>
            <Step><StepLabel>Refine Rules</StepLabel></Step>
            <Step><StepLabel>SHACL Shapes</StepLabel></Step>
            <Step><StepLabel>Playground Test</StepLabel></Step>
          </Stepper>

          {/* Step 0: Input Criteria & Upload Schema */}
          {step === 0 && (
            <Box className="validation-card" sx={{ maxWidth: 800, margin: "0 auto" }}>
              <Typography className="validation-card-title">
                Explain Your Validation Situation
              </Typography>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Tell the AI validation assistant what data properties you want to check (e.g., sensor bounds, positive pressures, presence of links). Upload an ontology schema (.ttl, .rdf) or choose your active workspace schema to ground the recommendations.
              </Typography>

              <TextField
                label="Situation Description (English)"
                multiline
                rows={4}
                fullWidth
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="I want to validate my CMP process data. WAFER pressure must be positive, rotation speeds must be at least 10rpm, and every run must link to a copper wafer..."
                sx={{ mb: 3 }}
              />

              <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel id="playground-schema-select">Select Active Schema Context</InputLabel>
                    <Select
                      labelId="playground-schema-select"
                      value={selectedSchema}
                      label="Select Active Schema Context"
                      onChange={(e) => setSelectedSchema(e.target.value)}
                    >
                      {schemas.map((s) => (
                        <MenuItem key={s.schema_id} value={s.schema_id}>
                          {s.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} sx={{ display: "flex", alignItems: "center" }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<CloudUploadIcon />}
                    fullWidth
                    sx={{ py: 1.5, textTransform: "none", borderStyle: "dashed" }}
                  >
                    {playgroundSchemaName ? `Uploaded: ${playgroundSchemaName}` : "Or Upload Custom Schema (.ttl)"}
                    <input type="file" hidden accept=".ttl,.rdf,.owl" onChange={handleFileUpload} />
                  </Button>
                </Grid>
              </Grid>

              <Button
                variant="contained"
                className="validation-primary-btn"
                startIcon={assistantLoading ? <CircularProgress size={20} color="inherit" /> : <AutoAwesomeIcon />}
                disabled={assistantLoading}
                onClick={handleSuggestRules}
                fullWidth
              >
                {assistantLoading ? "AI Analyzing Schema & Generating Rules..." : "Ask AI to Suggest 10 Validation Questions"}
              </Button>
            </Box>
          )}

          {/* Step 1: Select & Refine Recommendations */}
          {step === 1 && (
            <Box className="validation-card" sx={{ maxWidth: 850, margin: "0 auto" }}>
              <Typography className="validation-card-title">
                Select and Refine Recommended Rules
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                AI recommended the following 10 validation questions. You can toggle checkboxes to choose which ones to compile, edit their text directly, or write custom rules in the textbox below.
              </Typography>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
                {suggestedRules.map((rule, idx) => (
                  <Box key={idx} className="validation-rule-wrapper">
                    <Checkbox
                      checked={!!selectedRules[idx]}
                      onChange={(e) => setSelectedRules({ ...selectedRules, [idx]: e.target.checked })}
                    />
                    <TextField
                      variant="standard"
                      fullWidth
                      value={rule}
                      onChange={(e) => {
                        const newRules = [...suggestedRules];
                        newRules[idx] = e.target.value;
                        setSuggestedRules(newRules);
                      }}
                      InputProps={{ disableUnderline: true }}
                      sx={{ ml: 1, fontWeight: 500 }}
                    />
                  </Box>
                ))}
              </Box>

              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Add Custom Rules (One per line)
              </Typography>
              <TextField
                multiline
                rows={3}
                fullWidth
                variant="outlined"
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder="Wafer material category must be 'Metal' or 'Dielectric'"
                sx={{ mb: 3 }}
              />

              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Button variant="outlined" className="validation-secondary-btn" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  variant="contained"
                  className="validation-primary-btn"
                  disabled={assistantLoading}
                  onClick={handleCompileSHACL}
                  startIcon={assistantLoading && <CircularProgress size={20} color="inherit" />}
                >
                  Compile rules into SHACL (.ttl)
                </Button>
              </Box>
            </Box>
          )}

          {/* Step 2: Review Generated SHACL shapes code */}
          {step === 2 && (
            <Box className="validation-card" sx={{ maxWidth: 850, margin: "0 auto" }}>
              <Typography className="validation-card-title">
                Review Generated SHACL Shapes Code
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                The AI has compiled your selected rules into SHACL constraint syntax. You can edit the code directly here before testing it in the playground.
              </Typography>

              <TextField
                multiline
                rows={15}
                fullWidth
                variant="outlined"
                value={compiledSHACL}
                onChange={(e) => {
                  setCompiledSHACL(e.target.value);
                  setPlaygroundShaclText(e.target.value);
                }}
                InputProps={{ className: "validation-code-area" }}
                sx={{ mb: 3 }}
              />

              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Button variant="outlined" className="validation-secondary-btn" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  variant="contained"
                  className="validation-primary-btn"
                  onClick={() => setStep(3)}
                >
                  Proceed to Playground
                </Button>
              </Box>
            </Box>
          )}

          {/* Step 3: Playground validation editor & output */}
          {step === 3 && (
            <Box>
              <Grid container spacing={3} sx={{ mb: 3 }}>
                {/* Shapes Column */}
                <Grid item xs={12} md={4}>
                  <Box className="validation-card" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      SHACL Shapes (.ttl)
                    </Typography>
                    <TextField
                      multiline
                      rows={14}
                      fullWidth
                      variant="outlined"
                      value={playgroundShaclText}
                      onChange={(e) => setPlaygroundShaclText(e.target.value)}
                      InputProps={{ className: "validation-code-area" }}
                    />
                  </Box>
                </Grid>

                {/* Schema Column */}
                <Grid item xs={12} md={4}>
                  <Box className="validation-card" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Ontology Schema (.ttl)
                    </Typography>
                    <TextField
                      multiline
                      rows={14}
                      fullWidth
                      variant="outlined"
                      placeholder="# Optional: Paste or upload schema TTL code..."
                      value={playgroundSchemaText}
                      onChange={(e) => setPlaygroundSchemaText(e.target.value)}
                      InputProps={{ className: "validation-code-area" }}
                    />
                  </Box>
                </Grid>

                {/* Instances Column */}
                <Grid item xs={12} md={4}>
                  <Box className="validation-card" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Instances Data (.ttl)
                    </Typography>
                    <TextField
                      multiline
                      rows={14}
                      fullWidth
                      variant="outlined"
                      value={playgroundInstancesText}
                      onChange={(e) => setPlaygroundInstancesText(e.target.value)}
                      InputProps={{ className: "validation-code-area" }}
                    />
                  </Box>
                </Grid>
              </Grid>

              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 4 }}>
                <Button variant="outlined" className="validation-secondary-btn" onClick={() => setStep(2)}>
                  Back to SHACL Shapes
                </Button>
                
                <Button
                  variant="contained"
                  className="validation-primary-btn"
                  disabled={assistantLoading}
                  startIcon={assistantLoading ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handlePlaygroundValidate}
                  sx={{ px: "32px !important" }}
                >
                  Run Playground Validation
                </Button>
              </Box>

              {playgroundError && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: "8px" }}>
                  {playgroundError}
                </Alert>
              )}

              {/* Playground validation results */}
              {playgroundReport && (
                <Box>
                  <Box className="validation-card" sx={{ mb: 3 }}>
                    <Box className="validation-results-summary">
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          PLAYGROUND STATUS
                        </Typography>
                        <Box sx={{ display: "flex", alignItems: "center", mt: 0.5 }}>
                          {playgroundReport.conforms ? (
                            <Box className="validation-status-badge pass">
                              <CheckCircleIcon sx={{ fontSize: 20 }} /> CONFORMS
                            </Box>
                          ) : (
                            <Box className="validation-status-badge fail">
                              <CancelIcon sx={{ fontSize: 20 }} /> FAILED
                            </Box>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
                        <Box>
                          <Typography variant="body2">Violations: <b>{playgroundReport.total_violations}</b></Typography>
                          <Typography variant="body2">Triples: <b>{playgroundReport.total_triples}</b></Typography>
                        </Box>
                        <Button
                          variant="outlined"
                          className="validation-secondary-btn"
                          startIcon={<DownloadIcon />}
                          onClick={() => handleDownloadPDF(playgroundReport)}
                          sx={{ height: "40px !important" }}
                        >
                          Download PDF Report
                        </Button>
                      </Box>
                    </Box>
                  </Box>

                  {/* Rules table */}
                  <Box className="validation-card" sx={{ mb: 3 }}>
                    <Typography className="validation-card-title">
                      Rules Evaluated
                    </Typography>
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
                                {r.status === "Pass" ? (
                                  <Box sx={{ color: "var(--accent-success)", fontWeight: 700 }}>Pass</Box>
                                ) : (
                                  <Box sx={{ color: "var(--accent-error)", fontWeight: 700 }}>Fail</Box>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>

                  {/* Violations Log table */}
                  {playgroundReport.violations && playgroundReport.violations.length > 0 && (
                    <Box className="validation-card">
                      <Typography className="validation-card-title" sx={{ color: "var(--accent-error) !important" }}>
                        Violations Log
                      </Typography>
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
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
