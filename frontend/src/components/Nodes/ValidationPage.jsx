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
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import VerifiedIcon from "@mui/icons-material/Verified";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import BuildIcon from "@mui/icons-material/Build";

import "./ValidationPage.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STEPS = [
  "Define Questions",
  "Finalize Questions",
  "SHACL Shapes",
  "Validate & Report"
];

const SAMPLE_INSTANCES = `@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

inst:CMPProcess_2_100 a cmpo:CMPProcess ;
    rdfs:label "CMP Process 2 (row 100)" ;
    cmpo:hasInput inst:Wafer_2981014422 ;
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

  //  Workspace validation target schemas 
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

  //  Core state 
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [infoDialog, setInfoDialog] = useState(false);

  //  Step 0 
  const [inputMode, setInputMode] = useState("ai");
  const [schemaFile, setSchemaFile] = useState(null);
  const [instanceFile, setInstanceFile] = useState(null);
  const [combinedFile, setCombinedFile] = useState(null);
  const [schemaFileText, setSchemaFileText] = useState("");
  const [instanceFileText, setInstanceFileText] = useState("");
  const [aiContextPrompt, setAiContextPrompt] = useState("");
  const [numQuestions, setNumQuestions] = useState(10);
  const [manualQuestionsText, setManualQuestionsText] = useState("");

  //  Step 1 
  const [questions, setQuestions] = useState([]);
  const [newQuestionText, setNewQuestionText] = useState("");

  //  Step 2 
  const [shaclCode, setShaclCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [shaclGenerationSteps, setShaclGenerationSteps] = useState([]);
  const [verificationMap, setVerificationMap] = useState({});
  const [verifying, setVerifying] = useState(false);

  //  Step 3 
  const [playgroundSchemaText, setPlaygroundSchemaText] = useState("");
  const [playgroundInstancesText, setPlaygroundInstancesText] = useState(SAMPLE_INSTANCES);
  const [playgroundShaclText, setPlaygroundShaclText] = useState("");
  const [playgroundSchemaFullText, setPlaygroundSchemaFullText] = useState("");
  const [playgroundInstancesFullText, setPlaygroundInstancesFullText] = useState("");
  const [playgroundReport, setPlaygroundReport] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [expandedRules, setExpandedRules] = useState({});
  const [expandedAdvanced, setExpandedAdvanced] = useState({});
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
  const shaclFileInputRef = useRef(null);

  //  File helpers 
  const readFileAsText = (file) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsText(file);
    });

  const handleShaclFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    setPlaygroundShaclText(text);
    setShaclCode(text);
    setSuccess(`Loaded SHACL shape file: ${file.name}`);
    e.target.value = "";
  };

  const handleStepClick = (stepIdx) => {
    if (stepIdx === 3) {
      handleProceedToPlayground();
    } else {
      setActiveStep(stepIdx);
      setError(null);
      setSuccess(null);
    }
  };

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

  //  Step 0 → 1: AI generation 
  const handleGenerateQuestions = async () => {
    setLoading(true);
    setError(null);

    const formData = new FormData();
    if (aiContextPrompt) formData.append("user_explanation", aiContextPrompt);
    formData.append("num_questions", numQuestions);

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
        setSuccess(`AI generated ${res.data.rules.length} validation questions from your files.`);
        setActiveStep(1);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to generate questions. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  //  Step 0 → 1: Manual submission 
  const handleManualSubmit = () => {
    const lines = manualQuestionsText.split("\n").map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;
    setQuestions(lines.map((r) => ({ text: r, selected: true })));
    setActiveStep(1);
  };


  //  Step 1: question management 
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

  //  Step 1 → 2: Generate SHACL 
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
        `@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n` +
        `@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n\n` +
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
              } else if (event.status === "verifying") {
                // Show checking/fixing status for the rule being verified
                setShaclGenerationSteps(prev => 
                  prev.map((step, idx) => 
                    idx === event.index 
                      ? { ...step, status: "verifying", verifyStage: event.stage, message: event.message } 
                      : step
                  )
                );
              } else if (event.status === "progress") {
                // Update rule status with verification metadata
                setShaclGenerationSteps(prev => 
                  prev.map((step, idx) => 
                    idx === event.index 
                      ? { 
                          ...step, 
                          status: event.result_status,
                          verification: event.verification || undefined,
                          attempts: event.attempts || 1,
                          unknown_terms: event.unknown_terms || [],
                          failed_examples: event.failed_examples || [],
                          reason: event.reason || ""
                        } 
                      : step
                  )
                );

                // Store verification metadata for this rule
                if (event.verification) {
                  setVerificationMap(prev => ({
                    ...prev,
                    [`inst:Question_${event.index + 1}_Shape`]: {
                      rule_text: event.rule,
                      verification: event.verification,
                      attempts: event.attempts || 1,
                      unknown_terms: event.unknown_terms || [],
                      failed_examples: event.failed_examples || [],
                      reason: event.reason || ""
                    },
                    [String(event.index)]: {
                      rule_text: event.rule,
                      verification: event.verification,
                      attempts: event.attempts || 1,
                      unknown_terms: event.unknown_terms || [],
                      failed_examples: event.failed_examples || [],
                      reason: event.reason || ""
                    }
                  }));
                }

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
                // Store the full verification map from completed event
                if (event.verification_map) {
                  setVerificationMap(event.verification_map);
                }
                setSuccess("SHACL shapes generated. Use \"Verify Shapes\" to run an extra correctness check.");
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

  //  Step 2: Optional further check (verify & repair generated shapes)
  // onlyIndices: re-check just these rules (e.g. "Retry AI fix" for the ones the AI could not verify)
  const handleVerifyShacl = async (onlyIndices = null) => {
    const rules = shaclGenerationSteps.map(step => step.rule);
    if (rules.length === 0 || !shaclCode.trim()) return;
    const isTarget = (idx) => !onlyIndices || onlyIndices.includes(idx);

    setVerifying(true);
    setError(null);
    setSuccess(null);
    setShaclGenerationSteps(prev => prev.map((step, idx) =>
      isTarget(idx) ? { ...step, status: "generating", verification: undefined, advice: "" } : step
    ));

    const formData = new FormData();
    formData.append("rules", JSON.stringify(rules));
    formData.append("shapes_ttl", shaclCode);
    if (onlyIndices) formData.append("indices", JSON.stringify(onlyIndices));
    if (combinedFile) formData.append("schema_file", combinedFile);
    else if (schemaFile) formData.append("schema_file", schemaFile);

    try {
      const token = localStorage.getItem("token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API}/validation/verify-shacl-stream`, {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.status === "verifying") {
              setShaclGenerationSteps(prev => prev.map((step, idx) =>
                idx === event.index
                  ? { ...step, status: "verifying", verifyStage: event.stage, message: event.message }
                  : step
              ));
            } else if (event.status === "progress") {
              setShaclGenerationSteps(prev => prev.map((step, idx) =>
                idx === event.index
                  ? {
                      ...step,
                      status: "success",
                      verification: event.verification,
                      attempts: event.attempts || 1,
                      unknown_terms: event.unknown_terms || [],
                      failed_examples: event.failed_examples || [],
                      reason: event.reason || "",
                      advice: event.advice || ""
                    }
                  : step
              ));
            } else if (event.status === "completed") {
              if (event.shacl_ttl) {
                setShaclCode(event.shacl_ttl);
                setPlaygroundShaclText(event.shacl_ttl);
              }
              if (event.verification_map) {
                // A retry only returns the re-checked rules, so merge into the existing results
                setVerificationMap(prev => onlyIndices ? { ...prev, ...event.verification_map } : event.verification_map);
                const results = Object.entries(event.verification_map).filter(([k]) => /^\d+$/.test(k)).map(([, v]) => v.verification);
                const failedCnt = results.filter(v => v === "unverified").length;
                setSuccess(failedCnt === 0
                  ? "AI verification finished. All checked shapes are verified (fixed shapes were updated in the code)."
                  : `AI verification finished. ${failedCnt} shape${failedCnt !== 1 ? "s" : ""} could not be verified — see the advice below, edit the shape, or click "Retry AI fix".`);
              }
            } else if (event.status === "error") {
              throw new Error(event.message || "Verification failed.");
            }
          } catch (e) {
            if (e instanceof SyntaxError) console.error("Failed to parse verify stream chunk", e);
            else throw e;
          }
        }
      }
    } catch (err) {
      setError(err.message || "Failed to verify SHACL shapes.");
      setShaclGenerationSteps(prev => prev.map(step =>
        step.status === "generating" || step.status === "verifying" ? { ...step, status: "success" } : step
      ));
    } finally {
      setVerifying(false);
    }
  };

  const unverifiedStepIndices = shaclGenerationSteps
    .map((step, idx) => (step.verification === "unverified" ? idx : -1))
    .filter(idx => idx >= 0);

  //  Step 2: Copy 
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

  //  Step 2 → 3: Proceed 
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
      setPlaygroundShaclText(prev => prev || shaclCode || "");
      
      setSuccess(null);
      setError(null);
      setActiveStep(3);
    } catch (err) {
      console.error("Error transitioning to playground step:", err);
      setError("Failed to transition to playground: " + err.message);
    }
  };

  //  Step 3: Validate (SSE streaming) 
  const handlePlaygroundValidate = async () => {
    setLoading(true);
    setError(null);
    setPlaygroundReport(null);
    setValidationSteps([]);
    setExpandedRules({});
    setExpandedAdvanced({});

    const formData = new URLSearchParams();
    formData.append("shacl_ttl", playgroundShaclText);

    // Pass verification metadata so the backend can split reliable vs unreliable
    if (verificationMap && Object.keys(verificationMap).length > 0) {
      formData.append("verification_metadata", JSON.stringify(verificationMap));
    }

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

  //  Step 3: Download PDF 
  const handleDownloadPDF = async (reportData) => {
    if (!reportData) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/validation/export-pdf`, { report_data: reportData }, {
        ...getAuthConfig(),
        responseType: "blob"
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `validation_report_${new Date().toISOString().slice(0, 10)}.pdf`);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        link.remove();
      }, 200);
    } catch (err) {
      console.error("PDF download error:", err);
      let errorMsg = "Failed to export PDF report.";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed.detail) errorMsg = `Failed to export PDF: ${parsed.detail}`;
        } catch { /* use default */ }
      } else if (err.response?.data?.detail) {
        errorMsg = `Failed to export PDF: ${err.response.data.detail}`;
      } else if (err.message) {
        errorMsg = `Failed to export PDF: ${err.message}`;
      }
      setError(errorMsg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  //  Back / Reset 
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
    setVerificationMap({});
    setExpandedAdvanced({});
    setError(null);
    setSuccess(null);
  };

  //  Auth gate 
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

        {/*  Header  */}
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

        {/*  Info Dialog  */}
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

          {/*  Custom Stepper  */}
          <div className="validation-stepper">
            <div className="validation-stepper-steps">
              {STEPS.map((label, idx) => (
                <div 
                  key={label} 
                  className={`validation-stepper-step ${activeStep === idx ? "active" : ""} ${activeStep > idx ? "completed" : ""}`}
                  onClick={() => handleStepClick(idx)}
                  title={`Go to ${label}`}
                >
                  <div className="validation-stepper-circle">{idx + 1}</div>
                  <p className="validation-stepper-label">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/*  Body  */}
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
                  Choose how to create your validation questions : let AI generate them from your data files, or enter them manually in plain English.
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

                {/*  AI Mode  */}
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

                    {/* Number of questions input */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <TextField
                        label="Number of questions to generate"
                        type="number"
                        size="small"
                        value={numQuestions}
                        onChange={(e) => setNumQuestions(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
                        inputProps={{ min: 1, max: 50 }}
                        sx={{ width: 250 }}
                        helperText="Enter how many questions you want AI to suggest (1 - 50)"
                      />
                    </Box>
                  </Stack>
                )}

                {/*  Manual Mode  */}
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
                        {loading ? "Generating Rules..." : verifying ? "Verifying Rules..." : "Rule Generation Status"}
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
                            {step.status === "verifying" && (
                              <BuildIcon sx={{ fontSize: 18, color: "#f59e0b", flexShrink: 0, animation: "spin 1.5s linear infinite" }} />
                            )}
                            {step.status === "success" && step.verification === "verified" && (
                              <VerifiedIcon sx={{ fontSize: 18, color: "var(--accent-success)", flexShrink: 0 }} />
                            )}
                            {step.status === "success" && step.verification === "repaired" && (
                              <VerifiedIcon sx={{ fontSize: 18, color: "#f59e0b", flexShrink: 0 }} />
                            )}
                            {step.status === "success" && step.verification === "unverified" && (
                              <HelpOutlineIcon sx={{ fontSize: 18, color: "var(--text-secondary)", flexShrink: 0 }} />
                            )}
                            {step.status === "success" && !step.verification && (
                              <CheckCircleIcon sx={{ fontSize: 18, color: "var(--accent-success)", flexShrink: 0 }} />
                            )}
                            {step.status === "error" && (
                              <CancelIcon sx={{ fontSize: 18, color: "var(--accent-error)", flexShrink: 0 }} />
                            )}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" color={step.status === "pending" ? "textSecondary" : "textPrimary"} noWrap>
                                {step.rule}
                              </Typography>
                              {step.status === "verifying" && step.message && (
                                <Typography variant="caption" sx={{ color: "#f59e0b", fontStyle: "italic" }}>
                                  {step.message}
                                </Typography>
                              )}
                              {step.status === "success" && step.verification && (
                                <Typography variant="caption" sx={{ 
                                  color: step.verification === "verified" ? "var(--accent-success)" 
                                       : step.verification === "repaired" ? "#f59e0b" 
                                       : "var(--text-secondary)" 
                                }}>
                                  {step.verification === "verified" ? "Verified by AI" 
                                   : step.verification === "repaired" ? `Fixed by AI after ${step.attempts || 1} attempt(s) — the corrected shape is in the code below` 
                                   : "AI could not verify this shape"}
                                </Typography>
                              )}
                              {step.status === "success" && step.verification === "unverified" && step.advice && (
                                <Typography variant="caption" display="block" sx={{ color: "#d97706", mt: 0.25, whiteSpace: "normal" }}>
                                  {step.advice}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
                  <Typography variant="h6">Generated SHACL Shapes</Typography>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleVerifyShacl()}
                      disabled={loading || verifying || !shaclCode.trim()}
                      startIcon={verifying ? <CircularProgress size={16} /> : <VerifiedIcon />}
                    >
                      {verifying ? "Verifying..." : "Verify Shapes"}
                    </Button>
                    {unverifiedStepIndices.length > 0 && !verifying && (
                      <Button
                        variant="outlined"
                        size="small"
                        color="warning"
                        onClick={() => handleVerifyShacl(unverifiedStepIndices)}
                        disabled={loading || !shaclCode.trim()}
                        startIcon={<BuildIcon />}
                      >
                        Retry AI fix ({unverifiedStepIndices.length})
                      </Button>
                    )}
                    <button 
                      className={`validation-copy-btn ${copied ? "copied" : ""}`} 
                      onClick={handleCopyShacl}
                      disabled={loading || verifying}
                    >
                      {copied ? <><CheckIcon sx={{ fontSize: 16 }} /> Copied!</> : <><ContentCopyIcon sx={{ fontSize: 16 }} /> Copy to Clipboard</>}
                    </button>
                  </Box>
                </Box>

                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  AI has compiled your questions into SHACL shapes (Turtle format). You can edit the code, copy it to an external SHACL playground, or proceed to validate in-app. To double-check the shapes, click "Verify Shapes" - each rule is tested and automatically fixed if needed.
                </Typography>

                <TextField
                  multiline
                  rows={16}
                  fullWidth
                  variant="outlined"
                  value={shaclCode}
                  onChange={(e) => {
                    setShaclCode(e.target.value);
                    setPlaygroundShaclText(e.target.value);
                    // Manual edits invalidate any previous verification result
                    if (Object.keys(verificationMap).length > 0) {
                      setVerificationMap({});
                      setShaclGenerationSteps(prev => prev.map(step => ({ ...step, verification: undefined })));
                    }
                  }}
                  InputProps={{
                    className: "validation-code-area",
                    readOnly: loading || verifying
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
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        SHACL Shapes (.ttl)
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<CloudUploadIcon />}
                          onClick={() => shaclFileInputRef.current?.click()}
                        >
                          Upload Existing SHACL File (.ttl)
                        </Button>
                        <input
                          ref={shaclFileInputRef}
                          type="file"
                          accept=".ttl,.rdf,.owl"
                          onChange={handleShaclFileUpload}
                          style={{ display: "none" }}
                        />
                      </Box>
                    </Box>
                    <TextField
                      multiline
                      rows={18}
                      fullWidth
                      variant="outlined"
                      value={playgroundShaclText}
                      onChange={(e) => setPlaygroundShaclText(e.target.value)}
                      InputProps={{ className: "validation-code-area" }}
                      placeholder="# Upload or paste your existing SHACL shapes (.ttl) here..."
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

                {/*  Validation Results  */}
                {playgroundReport && (() => {
                  const totalRules = playgroundReport.total_questions || playgroundReport.rules?.length || 0;
                  const passedRules = playgroundReport.passed_questions ?? playgroundReport.rules?.filter(r => r.status === "Pass").length ?? 0;
                  const failedRules = playgroundReport.failed_questions ?? (totalRules - passedRules);
                  const passPct = playgroundReport.pass_percentage ?? (totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 0);

                  const verifiedCnt = playgroundReport.verified_count ?? 0;
                  const repairedCnt = playgroundReport.repaired_count ?? 0;
                  const unverifiedCnt = playgroundReport.unverified_count ?? 0;
                  const suspiciousCnt = playgroundReport.suspicious_count ?? 0;
                  const notCheckedCnt = playgroundReport.not_checked_count ?? (playgroundReport.rules?.filter(r => !r.verification || r.verification === "not_checked").length || 0);
                  const aiVerifiedCnt = verifiedCnt + repairedCnt;
                  const needsReview = (r) => r.verification === "unverified" || r.suspicious;

                  const reliableRules = playgroundReport.reliable_rules || playgroundReport.rules?.filter(r => !needsReview(r)) || [];
                  const unreliableRules = playgroundReport.unreliable_rules || playgroundReport.rules?.filter(needsReview) || [];
                  const unreliableCnt = unreliableRules.length;

                  const aiSummary = notCheckedCnt === totalRules
                    ? "Shapes were not verified by AI (use \"Verify Shapes\" in step 2)."
                    : `AI verification: ${verifiedCnt} verified, ${repairedCnt} fixed${unverifiedCnt ? `, ${unverifiedCnt} could not be verified` : ""}${notCheckedCnt ? `, ${notCheckedCnt} not checked` : ""}.`;
                  const AI_STATUS = {
                    verified: { label: "Verified by AI", color: "var(--accent-success)", bg: "rgba(16, 185, 129, 0.1)", icon: <VerifiedIcon sx={{ fontSize: 14 }} /> },
                    repaired: { label: "Fixed by AI", color: "var(--accent-success)", bg: "rgba(16, 185, 129, 0.1)", icon: <BuildIcon sx={{ fontSize: 14 }} /> },
                    unverified: { label: "AI could not verify", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.1)", icon: <HelpOutlineIcon sx={{ fontSize: 14 }} /> },
                    not_checked: { label: "Not checked by AI", color: "var(--text-secondary)", bg: "var(--bg-tertiary)", icon: <InfoOutlinedIcon sx={{ fontSize: 14 }} /> },
                  };

                  const gate = playgroundReport.gate_decision || (playgroundReport.conforms ? 'Pass' : 'Fail');
                  const bannerClass = gate === 'Pass' ? 'pass' : gate === 'Needs review' ? 'partial' : failedRules === 0 ? 'pass' : (passedRules === 0 ? 'fail' : 'partial');
                  const bannerTitle = playgroundReport.status_summary || `${passedRules} of ${totalRules} Rules Passed (${passPct}%)`;

                  const renderRuleCard = (rule, i, isReliableSection) => {
                    const ruleViolations = violationsByShape[rule.shape_iri] || [];
                    const isFail = rule.status !== "Pass";
                    const isExpanded = expandedRules[rule.shape_iri];
                    const isAdvExpanded = expandedAdvanced[rule.shape_iri];
                    const failedItemCount = rule.failed_items_count !== undefined ? rule.failed_items_count : ruleViolations.length;
                    const isReliable = !needsReview(rule);
                    const aiStatus = AI_STATUS[rule.verification] || AI_STATUS.not_checked;

                    return (
                      <Box key={`${isReliableSection}-${i}`} className={`validation-rule-card ${isFail ? "fail" : "pass"} ${!isReliable && isFail ? "unreliable" : ""}`}>
                        <Box 
                          className="validation-rule-header"
                          onClick={() => isFail && ruleViolations.length > 0 && toggleRuleExpand(rule.shape_iri)}
                          sx={{ cursor: isFail && ruleViolations.length > 0 ? "pointer" : "default" }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
                            {isFail 
                              ? <CancelIcon sx={{ fontSize: 20, color: isReliable ? "var(--accent-error)" : "#f59e0b", flexShrink: 0 }} />
                              : <CheckCircleIcon sx={{ fontSize: 20, color: "var(--accent-success)", flexShrink: 0 }} />
                            }
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                                {rule.rule_text || rule.label}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                Target: {rule.target_class_short || "All Items"}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {/* AI verification badge */}
                            <Chip
                              icon={aiStatus.icon}
                              label={rule.verification_label || aiStatus.label}
                              size="small"
                              sx={{ bgcolor: aiStatus.bg, color: aiStatus.color, fontWeight: 600, fontSize: 11, height: 24, "& .MuiChip-icon": { color: "inherit" } }}
                            />
                            {isFail ? (
                              <Chip 
                                label={`${failedItemCount} flagged`}
                                size="small"
                                sx={{ bgcolor: isReliable ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)", color: isReliable ? "var(--accent-error)" : "#f59e0b", fontWeight: 600, fontSize: 12, height: 24 }}
                              />
                            ) : (
                              <Chip label="Pass" size="small" sx={{ bgcolor: "rgba(16, 185, 129, 0.1)", color: "var(--accent-success)", fontWeight: 600, fontSize: 12, height: 24 }} />
                            )}
                            {rule.suspicious && (
                              <Chip label="Suspicious" size="small" sx={{ bgcolor: "rgba(245, 158, 11, 0.15)", color: "#d97706", fontWeight: 600, fontSize: 11, height: 22 }} />
                            )}
                            {isFail && ruleViolations.length > 0 && (
                              isExpanded 
                                ? <ExpandLessIcon sx={{ fontSize: 20, color: "var(--text-secondary)" }} />
                                : <ExpandMoreIcon sx={{ fontSize: 20, color: "var(--text-secondary)" }} />
                            )}
                          </Box>
                        </Box>

                        {/* Unreliable notice */}
                        {!isReliable && isFail && (
                          <Box sx={{ px: 2, py: 1, bgcolor: "rgba(245, 158, 11, 0.06)", borderTop: "1px solid rgba(245, 158, 11, 0.15)" }}>
                            <Typography variant="caption" sx={{ color: "#d97706", fontStyle: "italic" }}>
                              This check flagged {failedItemCount} item{failedItemCount !== 1 ? "s" : ""}. The check itself may be wrong, not your data.
                            </Typography>
                          </Box>
                        )}
                        {/* What to do when the AI could not verify the shape */}
                        {rule.verification === "unverified" && rule.advice && (
                          <Box sx={{ px: 2, py: 1, bgcolor: "rgba(245, 158, 11, 0.06)", borderTop: "1px solid rgba(245, 158, 11, 0.15)" }}>
                            <Typography variant="caption" sx={{ color: "#d97706" }}>
                              <b>What to do:</b> {rule.advice}
                            </Typography>
                          </Box>
                        )}

                        {/* Expandable Violations */}
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Box className="validation-rule-violations">
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                              <WarningAmberIcon sx={{ fontSize: 16, color: isReliable ? "var(--accent-error)" : "#f59e0b" }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: isReliable ? "var(--accent-error)" : "#f59e0b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                {ruleViolations.length} Item{ruleViolations.length !== 1 ? "s" : ""} Flagged
                              </Typography>
                            </Box>
                            <TableContainer sx={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border-light)", overflow: "hidden" }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ bgcolor: "var(--bg-tertiary)" }}>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Affected Item</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Property</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Description</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 12, py: 1 }}>Value</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {ruleViolations.slice(0, 50).map((v, vi) => (
                                    <TableRow key={vi} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                                      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11, py: 0.75 }}>{v.focus_node_short}</TableCell>
                                      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11, py: 0.75 }}>{v.path_short}</TableCell>
                                      <TableCell sx={{ fontSize: 12, py: 0.75 }}>{v.message}</TableCell>
                                      <TableCell sx={{ fontSize: 12, py: 0.75, color: isReliable ? "var(--accent-error)" : "#d97706" }}>{v.value || "—"}</TableCell>
                                    </TableRow>
                                  ))}
                                  {ruleViolations.length > 50 && (
                                    <TableRow>
                                      <TableCell colSpan={4} sx={{ fontSize: 12, py: 0.75, fontStyle: "italic", color: "var(--text-secondary)" }}>
                                        ... and {ruleViolations.length - 50} more items
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </TableContainer>

                            {/* Advanced details (collapsed) */}
                            {(rule.unknown_terms?.length > 0 || rule.failed_examples?.length > 0 || rule.attempts > 1 || rule.reason) && (
                              <Box sx={{ mt: 1.5 }}>
                                <Box 
                                  sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", userSelect: "none" }}
                                  onClick={(e) => { e.stopPropagation(); setExpandedAdvanced(prev => ({ ...prev, [rule.shape_iri]: !prev[rule.shape_iri] })); }}
                                >
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: "var(--text-secondary)" }}>Advanced details</Typography>
                                  {isAdvExpanded ? <ExpandLessIcon sx={{ fontSize: 16, color: "var(--text-secondary)" }} /> : <ExpandMoreIcon sx={{ fontSize: 16, color: "var(--text-secondary)" }} />}
                                </Box>
                                <Collapse in={isAdvExpanded} timeout="auto" unmountOnExit>
                                  <Box sx={{ mt: 1, p: 1.5, bgcolor: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-light)" }}>
                                    {rule.verification && (
                                      <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                                        <b>Check status:</b> {rule.verification === "verified" ? "Checked and reliable" : rule.verification === "repaired" ? "Fixed automatically" : "Could not be fully checked"}
                                      </Typography>
                                    )}
                                    {rule.attempts > 1 && (
                                      <Typography variant="caption" display="block" sx={{ mb: 0.5 }}><b>Attempts:</b> {rule.attempts}</Typography>
                                    )}
                                    {rule.reason && (
                                      <Typography variant="caption" display="block" sx={{ mb: 0.5 }}><b>Reason:</b> {rule.reason}</Typography>
                                    )}
                                    {rule.unknown_terms?.length > 0 && (
                                      <Typography variant="caption" display="block" sx={{ mb: 0.5 }}><b>Unknown terms:</b> {rule.unknown_terms.join(", ")}</Typography>
                                    )}
                                    {rule.failed_examples?.length > 0 && (
                                      <Typography variant="caption" display="block"><b>Failed test examples:</b> {rule.failed_examples.length}</Typography>
                                    )}
                                  </Box>
                                </Collapse>
                              </Box>
                            )}
                          </Box>
                        </Collapse>
                      </Box>
                    );
                  };

                  return (
                    <Stack spacing={2.5} sx={{ mt: 2 }}>

                      {/*  Summary Banner  */}
                      <Box className={`validation-summary-banner ${bannerClass}`}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                            {gate === 'Pass' ? (
                              <CheckCircleIcon sx={{ fontSize: 36 }} />
                            ) : gate === 'Needs review' ? (
                              <HelpOutlineIcon sx={{ fontSize: 36 }} />
                            ) : passedRules > 0 ? (
                              <WarningAmberIcon sx={{ fontSize: 36 }} />
                            ) : (
                              <CancelIcon sx={{ fontSize: 36 }} />
                            )}
                            <Box>
                              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                {bannerTitle}
                              </Typography>
                              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                                {unreliableCnt > 0 ? `${unreliableCnt} of ${totalRules} checks need your review${suspiciousCnt ? ` (${suspiciousCnt} flag almost every item)` : ""}. ` : ""}{aiSummary}
                                {gate === 'Needs review' && " Only unverified checks flagged issues — your data may be fine."}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 2 }}>
                            <Box sx={{ textAlign: "right" }}>
                              <Typography variant="body2" sx={{ opacity: 0.85 }}>{playgroundReport.total_triples} triples evaluated</Typography>
                            </Box>
                            <Button 
                              variant="outlined" 
                              size="small"
                              disabled={downloadingPdf}
                              startIcon={downloadingPdf ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} 
                              onClick={() => handleDownloadPDF(playgroundReport)}
                              sx={{ 
                                borderColor: 'rgba(255,255,255,0.5)', 
                                color: 'inherit', 
                                fontWeight: 600,
                                '&:hover': { borderColor: 'rgba(255,255,255,0.8)', bgcolor: 'rgba(255,255,255,0.15)' }
                              }}
                            >
                              {downloadingPdf ? "Generating..." : "PDF Report"}
                            </Button>
                          </Box>
                        </Box>

                        {totalRules > 0 && (
                          <Box sx={{ mt: 2 }}>
                            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                              <Typography variant="caption" sx={{ opacity: 0.9, fontWeight: 500 }}>
                                {passedRules} / {totalRules} rules passed
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.9, fontWeight: 600 }}>
                                {passPct}%
                              </Typography>
                            </Box>
                            <LinearProgress 
                              variant="determinate" 
                              value={passPct}
                              sx={{ 
                                height: 8, 
                                borderRadius: 4, 
                                bgcolor: 'rgba(255,255,255,0.25)',
                                '& .MuiLinearProgress-bar': { 
                                  borderRadius: 4,
                                  bgcolor: 'rgba(255,255,255,0.95)' 
                                }
                              }}
                            />
                          </Box>
                        )}
                      </Box>

                      {/*  KPI Summary Cards  */}
                      <Grid container spacing={1.5}>
                        <Grid item xs={6} sm={4}>
                          <Box className="validation-kpi-card kpi-success">
                            <Box className="validation-kpi-icon" sx={{ bgcolor: 'rgba(16, 185, 129, 0.12)' }}>
                              <CheckCircleIcon sx={{ fontSize: 20, color: 'var(--accent-success)' }} />
                            </Box>
                            <Typography className="validation-kpi-value" sx={{ color: 'var(--accent-success)' }}>
                              {playgroundReport.execution_status || 'Completed'}
                            </Typography>
                            <Typography className="validation-kpi-label">Execution Status</Typography>
                          </Box>
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          <Box className={`validation-kpi-card ${playgroundReport.conforms ? 'kpi-success' : 'kpi-danger'}`}>
                            <Box className="validation-kpi-icon" sx={{ bgcolor: playgroundReport.conforms ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)' }}>
                              {playgroundReport.conforms
                                ? <CheckCircleIcon sx={{ fontSize: 20, color: 'var(--accent-success)' }} />
                                : <CancelIcon sx={{ fontSize: 20, color: 'var(--accent-error)' }} />
                              }
                            </Box>
                            <Typography className="validation-kpi-value" sx={{ color: playgroundReport.conforms ? 'var(--accent-success)' : 'var(--accent-error)' }}>
                              {playgroundReport.conformance_status || (playgroundReport.conforms ? 'Conformant' : 'Non-Conformant')}
                            </Typography>
                            <Typography className="validation-kpi-label">Conformance Status</Typography>
                          </Box>
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          {(() => {
                            const isPass = gate === 'Pass';
                            const isReview = gate === 'Needs review';
                            const isConditional = gate === 'Conditional';
                            const gateColor = isPass ? 'var(--accent-success)' : (isConditional || isReview) ? '#f59e0b' : 'var(--accent-error)';
                            const gateBg = isPass ? 'rgba(16, 185, 129, 0.12)' : (isConditional || isReview) ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                            return (
                              <Box className={`validation-kpi-card ${isPass ? 'kpi-success' : (isConditional || isReview) ? 'kpi-warning' : 'kpi-danger'}`}>
                                <Box className="validation-kpi-icon" sx={{ bgcolor: gateBg }}>
                                  {isPass ? <CheckCircleIcon sx={{ fontSize: 20, color: gateColor }} />
                                    : (isConditional || isReview) ? <HelpOutlineIcon sx={{ fontSize: 20, color: gateColor }} />
                                    : <CancelIcon sx={{ fontSize: 20, color: gateColor }} />
                                  }
                                </Box>
                                <Typography className="validation-kpi-value" sx={{ color: gateColor }}>{gate}</Typography>
                                <Typography className="validation-kpi-label">Gate Decision</Typography>
                              </Box>
                            );
                          })()}
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          {(() => {
                            const cnt = playgroundReport.violation_count ?? playgroundReport.total_violations ?? 0;
                            return (
                              <Box className={`validation-kpi-card ${cnt > 0 ? 'kpi-danger' : 'kpi-success'}`}>
                                <Box className="validation-kpi-icon" sx={{ bgcolor: cnt > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)' }}>
                                  <CancelIcon sx={{ fontSize: 20, color: cnt > 0 ? 'var(--accent-error)' : 'var(--accent-success)' }} />
                                </Box>
                                <Typography className="validation-kpi-value" sx={{ color: cnt > 0 ? 'var(--accent-error)' : 'var(--accent-success)' }}>{cnt}</Typography>
                                <Typography className="validation-kpi-label">Flagged Problems</Typography>
                              </Box>
                            );
                          })()}
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          <Box className={`validation-kpi-card ${aiVerifiedCnt === totalRules ? 'kpi-success' : 'kpi-warning'}`}>
                            <Box className="validation-kpi-icon" sx={{ bgcolor: aiVerifiedCnt === totalRules ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)' }}>
                              <VerifiedIcon sx={{ fontSize: 20, color: aiVerifiedCnt === totalRules ? 'var(--accent-success)' : '#f59e0b' }} />
                            </Box>
                            <Typography className="validation-kpi-value" sx={{ color: aiVerifiedCnt === totalRules ? 'var(--accent-success)' : '#f59e0b' }}>
                              {aiVerifiedCnt} / {totalRules}
                            </Typography>
                            <Typography className="validation-kpi-label">Verified by AI</Typography>
                          </Box>
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          {(() => {
                            const cnt = playgroundReport.affected_focus_nodes ?? 0;
                            return (
                              <Box className={`validation-kpi-card ${cnt > 0 ? 'kpi-danger' : 'kpi-success'}`}>
                                <Box className="validation-kpi-icon" sx={{ bgcolor: cnt > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)' }}>
                                  <InfoOutlinedIcon sx={{ fontSize: 20, color: cnt > 0 ? 'var(--accent-error)' : 'var(--accent-success)' }} />
                                </Box>
                                <Typography className="validation-kpi-value" sx={{ color: cnt > 0 ? 'var(--accent-error)' : 'var(--accent-success)' }}>{cnt}</Typography>
                                <Typography className="validation-kpi-label">Affected Items</Typography>
                              </Box>
                            );
                          })()}
                        </Grid>
                      </Grid>

                      {/*  Reliable Rules Section  */}
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
                          <VerifiedIcon sx={{ fontSize: 20, color: "var(--accent-success)" }} />
                          {notCheckedCnt > 0 ? "Checks" : "Reliable Checks"} ({reliableRules.length})
                        </Typography>
                        {reliableRules.length > 0 ? (
                          <Stack spacing={1}>
                            {reliableRules.map((rule, i) => renderRuleCard(rule, i, true))}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="textSecondary" sx={{ fontStyle: "italic" }}>No checks in this section.</Typography>
                        )}
                      </Box>

                      {/*  Unreliable Rules Section  */}
                      {unreliableRules.length > 0 && (
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5, display: "flex", alignItems: "center", gap: 1 }}>
                            <HelpOutlineIcon sx={{ fontSize: 20, color: "#f59e0b" }} />
                            Checks That Need Your Review ({unreliableRules.length})
                          </Typography>
                          <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5, fontStyle: "italic" }}>
                            The AI could not verify these checks, or they flag almost every item. They do not cause a hard failure. The check itself may be wrong, not your data.
                          </Typography>
                          <Stack spacing={1}>
                            {unreliableRules.map((rule, i) => renderRuleCard(rule, i, false))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  );
                })()}
              </Box>
            )}
          </div>

          {/*  Footer Actions (same as instance-gen-actions)  */}
          <Box className="validation-actions">
            <Button disabled={activeStep === 0 || loading} onClick={handleBack} variant="outlined">
              Back
            </Button>

            {activeStep === 0 && inputMode === "ai" && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="outlined"
                  endIcon={<NavigateNextIcon />}
                  onClick={handleProceedToPlayground}
                >
                  Skip to Playground
                </Button>
                <Button
                  variant="contained"
                  onClick={handleGenerateQuestions}
                  disabled={loading || (!schemaFile && !instanceFile && !combinedFile)}
                >
                  {loading ? <CircularProgress size={24} /> : "Generate Questions"}
                </Button>
              </Box>
            )}

            {activeStep === 0 && inputMode === "manual" && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="outlined"
                  endIcon={<NavigateNextIcon />}
                  onClick={handleProceedToPlayground}
                >
                  Skip to Playground
                </Button>
                <Button variant="contained" onClick={handleManualSubmit} disabled={!manualQuestionsText.trim()}>
                  Proceed with Questions
                </Button>
              </Box>
            )}

            {activeStep === 1 && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="outlined"
                  endIcon={<NavigateNextIcon />}
                  onClick={handleProceedToPlayground}
                >
                  Skip to Playground
                </Button>
                <Button variant="contained" onClick={handleGenerateSHACL} disabled={loading || selectedCount === 0}>
                  {loading ? <CircularProgress size={24} /> : `Generate SHACL (${selectedCount} questions)`}
                </Button>
              </Box>
            )}

            {activeStep === 2 && (
              <Button variant="contained" onClick={handleProceedToPlayground} disabled={loading} endIcon={<NavigateNextIcon />}>
                Proceed to Playground
              </Button>
            )}

            {activeStep === 3 && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="outlined" onClick={handleReset}>Start Over</Button>
                {playgroundReport && (
                  <Button 
                    variant="outlined" 
                    disabled={downloadingPdf}
                    startIcon={downloadingPdf ? <CircularProgress size={18} /> : <DownloadIcon />} 
                    onClick={() => handleDownloadPDF(playgroundReport)}
                  >
                    {downloadingPdf ? "Generating PDF..." : "Download PDF Report"}
                  </Button>
                )}
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
