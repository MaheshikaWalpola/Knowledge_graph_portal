import React, { useRef } from "react";
import {
  Box,
  Paper,
  Button,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
  Alert,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function FileUploadStep({
  onSchemaUpload,
  onDataFilesUpload,
  schemaFile,
  dataFiles,
}) {
  const schemaInputRef = useRef(null);
  const dataInputRef = useRef(null);

  const handleSchemaChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      onSchemaUpload(file);
    }
  };

  const handleDataFilesChange = (event) => {
    const files = event.target.files;
    if (files) {
      onDataFilesUpload(Array.from(files));
    }
  };

  return (
    <Box className="file-upload-step">
      <Typography variant="h6" gutterBottom>
        Step 1: Upload Your Files
      </Typography>

      <Stack spacing={3}>
        {/* SCHEMA FILE UPLOAD */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              📋 RDF Schema File (Required)
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Upload an RDF/Turtle file containing your ontology schema
            </Typography>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                mt: 2,
              }}
            >
              <Button
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                onClick={() => schemaInputRef.current?.click()}
              >
                Choose Schema File
              </Button>

              {schemaFile && (
                <Chip
                  icon={<CheckCircleIcon />}
                  label={schemaFile.name}
                  color="success"
                  variant="outlined"
                />
              )}
            </Box>

            <input
              ref={schemaInputRef}
              type="file"
              accept=".ttl,.rdf,.owl"
              onChange={handleSchemaChange}
              style={{ display: "none" }}
            />

            {!schemaFile && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Supported formats: .ttl (Turtle), .rdf, .owl
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* DATA FILES UPLOAD */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              📊 CSV Data Files (Required)
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Upload one or more CSV files with data headers that correspond to
              your schema terms
            </Typography>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                mt: 2,
              }}
            >
              <Button
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                onClick={() => dataInputRef.current?.click()}
              >
                Choose CSV Files
              </Button>

              {dataFiles.length > 0 && (
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {dataFiles.map((file) => (
                    <Chip
                      key={file.name}
                      icon={<CheckCircleIcon />}
                      label={file.name}
                      color="success"
                      variant="outlined"
                    />
                  ))}
                </Box>
              )}
            </Box>

            <input
              ref={dataInputRef}
              type="file"
              accept=".csv"
              onChange={handleDataFilesChange}
              multiple
              style={{ display: "none" }}
            />

            {dataFiles.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                You can upload multiple CSV files. Headers from all files will be
                matched against your schema.
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* INFO SECTION */}
        <Alert severity="info">
          <Typography variant="subtitle2" gutterBottom>
            ℹ️ How This Works:
          </Typography>
          <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
            <li>Upload your RDF schema file</li>
            <li>Upload CSV files containing data with headers</li>
            <li>
              The system will analyze CSV headers and match them to schema terms
            </li>
            <li>You'll get a report showing matched and unmatched terms</li>
            <li>
              You can manually correct any mismatches before generating the
              instance
            </li>
          </ul>
        </Alert>
      </Stack>
    </Box>
  );
}
