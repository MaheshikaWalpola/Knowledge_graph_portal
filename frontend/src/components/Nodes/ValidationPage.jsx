import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Paper,
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
  FormControlLabel,
  Card,
  CardContent,
  IconButton,
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

export default function ValidationPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [user, setUser] = useState(null);
  
  // Auth details
  useEffect(() => {
    const storedUser = localStorage.getItem("kgp_user");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

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
      
      // Read schema file as text for playground step later
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
      <Box sx={{ p: 4, display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <Paper elevation={3} sx={{ p: 4, maxWidth: 500, textAlign: "center", borderRadius: "16px" }}>
          <Typography variant="h5" color="text.secondary" gutterBottom>
            Access Denied
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            You need to be logged in to access the Data Validation tab and Graph Validation services.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box className="validation-container" sx={{ maxWidth: 1200, margin: "0 auto", p: 3 }}>
      {/* Title */}
      <Paper elevation={0} sx={{ p: 3, mb: 3, backgroundColor: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: "#0f172a" }}>
          Data Quality Validation
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          Validate your RDF datasets against SHACL shapes rules, compile rules using AI, and export PDF compliance reports.
        </Typography>
      </Paper>

      {/* Tabs Header */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
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
            <Paper elevation={2} sx={{ p: 3, borderRadius: "16px" }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
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
                sx={{
                  fontFamily: "monospace",
                  fontSize: "13px",
                  backgroundColor: "#fafafa",
                  mb: 3
                }}
              />

              <Button
                variant="contained"
                startIcon={workspaceLoading ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
                disabled={workspaceLoading || !selectedSchema}
                onClick={handleWorkspaceValidate}
                fullWidth
                sx={{
                  backgroundColor: "#000",
                  color: "#fff",
                  textTransform: "none",
                  py: 1,
                  borderRadius: "30px",
                  "&:hover": { backgroundColor: "#333" }
                }}
              >
                Validate Active Workspace
              </Button>

              {workspaceError && (
                <Alert severity="error" sx={{ mt: 2, borderRadius: "8px" }}>
                  {workspaceError}
                </Alert>
              )}
            </Paper>
          </Grid>

          {/* Report column */}
          <Grid item xs={12} md={7}>
            {workspaceLoading ? (
              <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "60vh" }}>
                <CircularProgress size={45} color="primary" sx={{ mb: 2 }} />
                <Typography color="text.secondary">Running SHACL validator with RDFS inference...</Typography>
              </Box>
            ) : workspaceReport ? (
              <Box>
                {/* Result header card */}
                <Card sx={{ mb: 3, borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                  <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">
                        VALIDATION STATUS
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", mt: 0.5 }}>
                        {workspaceReport.conforms ? (
                          <CheckCircleIcon sx={{ color: "#10b981", mr: 1, fontSize: 32 }} />
                        ) : (
                          <CancelIcon sx={{ color: "#ef4444", mr: 1, fontSize: 32 }} />
                        )}
                        <Typography variant="h5" sx={{ fontWeight: 700, color: workspaceReport.conforms ? "#10b981" : "#ef4444" }}>
                          {workspaceReport.conforms ? "CONFORMS" : "FAILED"}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: "right" }}>
                      <Typography variant="body2" color="text.secondary">
                        Violations Found: <b>{workspaceReport.total_violations}</b>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Triples Validated: <b>{workspaceReport.total_triples}</b>
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={() => handleDownloadPDF(workspaceReport)}
                        sx={{ mt: 1, textTransform: "none", borderRadius: "15px" }}
                      >
                        Download PDF Report
                      </Button>
                    </Box>
                  </CardContent>
                </Card>

                {/* Rules Table */}
                <Paper sx={{ p: 3, mb: 3, borderRadius: "16px" }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    Rules Evaluated
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead sx={{ backgroundColor: "#f1f5f9" }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Rule/Shape</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Target Class</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="center">Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {workspaceReport.rules?.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell>{r.label}</TableCell>
                            <TableCell>{r.target_class_short}</TableCell>
                            <TableCell align="center">
                              {r.status === "Pass" ? (
                                <Box sx={{ color: "#10b981", fontWeight: 700 }}>Pass</Box>
                              ) : (
                                <Box sx={{ color: "#ef4444", fontWeight: 700 }}>Fail</Box>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>

                {/* Violations Table */}
                {workspaceReport.violations && workspaceReport.violations.length > 0 && (
                  <Paper sx={{ p: 3, borderRadius: "16px" }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#ef4444" }}>
                      Violations Log
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead sx={{ backgroundColor: "#f1f5f9" }}>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Focus Node</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Property Path</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Message</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {workspaceReport.violations.map((v, i) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontSize: "12px", fontFamily: "monospace" }}>{v.focus_node_short}</TableCell>
                              <TableCell sx={{ fontSize: "12px", fontFamily: "monospace" }}>{v.path_short}</TableCell>
                              <TableCell>{v.message}</TableCell>
                              <TableCell sx={{ fontSize: "12px" }}>{v.value}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                )}
              </Box>
            ) : (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", border: "2px dashed #cbd5e1", borderRadius: "16px", backgroundColor: "#fafafa" }}>
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
          <Stepper activeStep={step} sx={{ mb: 4 }}>
            <Step><StepLabel>Rule Criteria (AI)</StepLabel></Step>
            <Step><StepLabel>Refine Rules</StepLabel></Step>
            <Step><StepLabel>SHACL Shapes</StepLabel></Step>
            <Step><StepLabel>Playground Test</StepLabel></Step>
          </Stepper>

          {/* Step 0: Input Criteria & Upload Schema */}
          {step === 0 && (
            <Paper elevation={2} sx={{ p: 4, borderRadius: "16px", maxWidth: 800, margin: "0 auto" }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Explain Your Validation Situation
              </Typography>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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
                startIcon={assistantLoading ? <CircularProgress size={20} color="inherit" /> : <AutoAwesomeIcon />}
                disabled={assistantLoading}
                onClick={handleSuggestRules}
                fullWidth
                sx={{
                  backgroundColor: "#000",
                  color: "#fff",
                  py: 1.5,
                  borderRadius: "30px",
                  textTransform: "none",
                  "&:hover": { backgroundColor: "#333" }
                }}
              >
                {assistantLoading ? "AI Analyzing Schema & Generating Rules..." : "Ask AI to Suggest 10 Validation Questions"}
              </Button>
            </Paper>
          )}

          {/* Step 1: Select & Refine Recommendations */}
          {step === 1 && (
            <Paper elevation={2} sx={{ p: 4, borderRadius: "16px", maxWidth: 850, margin: "0 auto" }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                Select and Refine Recommended Rules
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                AI recommended the following 10 validation questions. You can toggle checkboxes to choose which ones to compile, edit their text directly, or write custom rules in the textbox below.
              </Typography>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
                {suggestedRules.map((rule, idx) => (
                  <Box key={idx} sx={{ display: "flex", alignItems: "center", border: "1px solid #e2e8f0", p: 1.5, borderRadius: "8px", backgroundColor: "#f8fafc" }}>
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
                <Button variant="outlined" onClick={() => setStep(0)} sx={{ textTransform: "none", borderRadius: "15px" }}>
                  Back
                </Button>
                <Button
                  variant="contained"
                  disabled={assistantLoading}
                  onClick={handleCompileSHACL}
                  startIcon={assistantLoading && <CircularProgress size={20} color="inherit" />}
                  sx={{
                    backgroundColor: "#000",
                    color: "#fff",
                    textTransform: "none",
                    borderRadius: "30px",
                    px: 3,
                    "&:hover": { backgroundColor: "#333" }
                  }}
                >
                  Compile rules into SHACL (.ttl)
                </Button>
              </Box>
            </Paper>
          )}

          {/* Step 2: Review Generated SHACL shapes code */}
          {step === 2 && (
            <Paper elevation={2} sx={{ p: 4, borderRadius: "16px", maxWidth: 850, margin: "0 auto" }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
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
                sx={{
                  fontFamily: "monospace",
                  fontSize: "13px",
                  backgroundColor: "#fafafa",
                  mb: 3
                }}
              />

              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Button variant="outlined" onClick={() => setStep(1)} sx={{ textTransform: "none", borderRadius: "15px" }}>
                  Back
                </Button>
                <Button
                  variant="contained"
                  onClick={() => setStep(3)}
                  sx={{
                    backgroundColor: "#000",
                    color: "#fff",
                    textTransform: "none",
                    borderRadius: "30px",
                    px: 3,
                    "&:hover": { backgroundColor: "#333" }
                  }}
                >
                  Proceed to Playground
                </Button>
              </Box>
            </Paper>
          )}

          {/* Step 3: Playground validation editor & output */}
          {step === 3 && (
            <Box>
              <Grid container spacing={3} sx={{ mb: 3 }}>
                {/* Shapes Column */}
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 2, borderRadius: "12px" }}>
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
                      sx={{ fontFamily: "monospace", fontSize: "12px", backgroundColor: "#fcfcfc" }}
                    />
                  </Paper>
                </Grid>

                {/* Schema Column */}
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 2, borderRadius: "12px" }}>
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
                      sx={{ fontFamily: "monospace", fontSize: "12px", backgroundColor: "#fcfcfc" }}
                    />
                  </Paper>
                </Grid>

                {/* Instances Column */}
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 2, borderRadius: "12px" }}>
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
                      sx={{ fontFamily: "monospace", fontSize: "12px", backgroundColor: "#fcfcfc" }}
                    />
                  </Paper>
                </Grid>
              </Grid>

              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 4 }}>
                <Button variant="outlined" onClick={() => setStep(2)} sx={{ textTransform: "none", borderRadius: "15px" }}>
                  Back to SHACL Shapes
                </Button>
                
                <Button
                  variant="contained"
                  disabled={assistantLoading}
                  startIcon={assistantLoading ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handlePlaygroundValidate}
                  sx={{
                    backgroundColor: "#000",
                    color: "#fff",
                    textTransform: "none",
                    borderRadius: "30px",
                    px: 4,
                    py: 1,
                    "&:hover": { backgroundColor: "#333" }
                  }}
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
                  <Card sx={{ mb: 3, borderRadius: "16px" }}>
                    <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          PLAYGROUND STATUS
                        </Typography>
                        <Box sx={{ display: "flex", alignItems: "center", mt: 0.5 }}>
                          {playgroundReport.conforms ? (
                            <CheckCircleIcon sx={{ color: "#10b981", mr: 1, fontSize: 32 }} />
                          ) : (
                            <CancelIcon sx={{ color: "#ef4444", mr: 1, fontSize: 32 }} />
                          )}
                          <Typography variant="h5" sx={{ fontWeight: 700, color: playgroundReport.conforms ? "#10b981" : "#ef4444" }}>
                            {playgroundReport.conforms ? "CONFORMS" : "FAILED"}
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ textAlign: "right" }}>
                        <Typography variant="body2">Violations: <b>{playgroundReport.total_violations}</b></Typography>
                        <Typography variant="body2">Triples: <b>{playgroundReport.total_triples}</b></Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<DownloadIcon />}
                          onClick={() => handleDownloadPDF(playgroundReport)}
                          sx={{ mt: 1, textTransform: "none", borderRadius: "15px" }}
                        >
                          Download PDF Report
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>

                  {/* Rules table */}
                  <Paper sx={{ p: 3, mb: 3, borderRadius: "16px" }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                      Rules Evaluated
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead sx={{ backgroundColor: "#f1f5f9" }}>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Rule/Shape</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Target Class</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="center">Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {playgroundReport.rules?.map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.label}</TableCell>
                              <TableCell>{r.target_class_short}</TableCell>
                              <TableCell align="center">
                                {r.status === "Pass" ? (
                                  <Box sx={{ color: "#10b981", fontWeight: 700 }}>Pass</Box>
                                ) : (
                                  <Box sx={{ color: "#ef4444", fontWeight: 700 }}>Fail</Box>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>

                  {/* Violations Log table */}
                  {playgroundReport.violations && playgroundReport.violations.length > 0 && (
                    <Paper sx={{ p: 3, borderRadius: "16px" }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#ef4444" }}>
                        Violations Log
                      </Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableHead sx={{ backgroundColor: "#f1f5f9" }}>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 600 }}>Focus Node</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Property Path</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Message</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {playgroundReport.violations.map((v, i) => (
                              <TableRow key={i}>
                                <TableCell sx={{ fontSize: "12px", fontFamily: "monospace" }}>{v.focus_node_short}</TableCell>
                                <TableCell sx={{ fontSize: "12px", fontFamily: "monospace" }}>{v.path_short}</TableCell>
                                <TableCell>{v.message}</TableCell>
                                <TableCell sx={{ fontSize: "12px" }}>{v.value}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Paper>
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
