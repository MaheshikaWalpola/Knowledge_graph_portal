import React, { useRef } from "react";
import {
  Box,
  Button,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ModelSelector from "./ModelSelector";
import PdfToCsvCard from "./PdfToCsvCard";

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

        {/* DATA FILES UPLOAD + PDF TO CSV CONVERSION */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 3,
            alignItems: "stretch",
          }}
        >
          {/* Same height as the PDF to CSV card next to it */}
          <Card variant="outlined" sx={{ height: "100%" }}>
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
                  flexWrap: "wrap",
                }}
              >
                {/* Full button until the first file is chosen, then a small icon so the row stays compact */}
                {dataFiles.length === 0 ? (
                  <Button
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    onClick={() => dataInputRef.current?.click()}
                  >
                    Choose CSV Files
                  </Button>
                ) : (
                  <Tooltip title="Add more CSV files">
                    <IconButton
                      color="primary"
                      size="small"
                      onClick={() => dataInputRef.current?.click()}
                      sx={{ border: 1, borderColor: "divider" }}
                    >
                      <CloudUploadIcon />
                    </IconButton>
                  </Tooltip>
                )}

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

          <PdfToCsvCard schemaFile={schemaFile} selectedModel={selectedModel} />
        </Box>

        {/* AI MODEL SELECTION */}
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          includeCloud
        />
      </Stack>
    </Box>
  );
}
