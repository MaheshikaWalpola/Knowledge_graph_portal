import React, { useRef } from "react";
import {
  Box,
  Button,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ModelSelector from "./ModelSelector";

export default function FileUploadStep({
  onSchemaUpload,
  onDataFilesUpload,
  schemaFile,
  dataFiles,
  onSchemaRemove,
  onDataFileRemove,
  selectedModel,
  onModelChange,
}) {
  const schemaInputRef = useRef(null);
  const dataInputRef = useRef(null);

  const handleSchemaChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      onSchemaUpload(file);
      event.target.value = "";
    }
  };

  const handleDataFilesChange = (event) => {
    const files = event.target.files;
    if (files) {
      onDataFilesUpload(Array.from(files));
      event.target.value = "";
    }
  };

  return (
    <Box className="file-upload-step">
      <Typography variant="h6" gutterBottom>
        Upload Files
      </Typography>

      <Stack spacing={3}>
        {/* SCHEMA FILE UPLOAD */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              RDF Schema File
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Your ontology file (.ttl, .rdf, or .owl)
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
                  onDelete={onSchemaRemove}
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
          </CardContent>
        </Card>

        {/* DATA FILES UPLOAD */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              CSV Data Files
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              One or more CSV files whose headers will be matched against schema terms
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
                      onDelete={() => onDataFileRemove(file.name)}
                    />
                  ))}
                </Box>
              )}
            </Box>

            <input
              ref={dataInputRef}
              type="file"
              accept=".csv,.zip"
              onChange={handleDataFilesChange}
              multiple
              style={{ display: "none" }}
            />
          </CardContent>
        </Card>

        {/* AI MODEL SELECTION */}
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={onModelChange}
        />
      </Stack>
    </Box>
  );
}
