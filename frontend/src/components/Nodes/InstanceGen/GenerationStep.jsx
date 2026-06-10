import React from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  AlertTitle,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Stack,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import DescriptionIcon from "@mui/icons-material/Description";
import StorageIcon from "@mui/icons-material/Storage";

export default function GenerationStep({
  generatedInstance,
  onDownload,
  loading,
  onGenerateAgain,
}) {
  if (loading) {
    return (
      <Box className="generation-step" sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="h6" gutterBottom>
          Generating Instance...
        </Typography>
        <LinearProgress sx={{ mb: 3 }} />
        <Typography variant="body2" color="textSecondary">
          Processing your schema and data files to create RDF instances
        </Typography>
      </Box>
    );
  }

  if (!generatedInstance) {
    return (
      <Box className="generation-step">
        <Typography variant="h6" gutterBottom>
          Step 4: Generate Instance
        </Typography>
        <Alert severity="info">
          <AlertTitle>Ready to Generate</AlertTitle>
          Click the "Generate Instance" button to create your RDF instance file
          based on the schema and data files you uploaded.
        </Alert>
      </Box>
    );
  }

  return (
    <Box className="generation-step">
      <Typography variant="h6" gutterBottom>
        Step 4: Instance Generated Successfully! 🎉
      </Typography>

      <Stack spacing={3}>
        {/* SUCCESS ALERT */}
        <Alert severity="success">
          <AlertTitle>Instance File Created</AlertTitle>
          Your RDF instance file has been generated successfully. You can now download
          it and upload it to your knowledge graph.
        </Alert>

        {/* INSTANCE DETAILS */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CheckCircleIcon sx={{ color: "success.main" }} />
              Instance File Details
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: "bold" }}>Filename</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <DescriptionIcon fontSize="small" />
                        {generatedInstance.filename || "instance.ttl"}
                      </Box>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: "bold" }}>Format</TableCell>
                    <TableCell>
                      <Chip label="Turtle (RDF/TTL)" size="small" color="info" variant="filled" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: "bold" }}>Triples Generated</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <StorageIcon fontSize="small" />
                        {generatedInstance.triples || "N/A"}
                      </Box>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: "bold" }}>File Size</TableCell>
                    <TableCell>
                      {generatedInstance.content
                        ? `${(generatedInstance.content.length / 1024).toFixed(2)} KB`
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                  {generatedInstance.rows_processed && (
                    <TableRow>
                      <TableCell sx={{ fontWeight: "bold" }}>Rows Processed</TableCell>
                      <TableCell>{generatedInstance.rows_processed}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        {/* PREVIEW */}
        {generatedInstance.preview && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                📋 Preview (First 10 Lines)
              </Typography>
              <Paper
                sx={{
                  p: 2,
                  backgroundColor: "#f5f5f5",
                  overflowX: "auto",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  maxHeight: "300px",
                  overflowY: "auto",
                }}
              >
                <pre>{generatedInstance.preview}</pre>
              </Paper>
            </CardContent>
          </Card>
        )}

        {/* NEXT STEPS */}
        <Alert severity="info">
          <Typography variant="subtitle2" gutterBottom>
            📝 Next Steps:
          </Typography>
          <ol style={{ margin: "8px 0", paddingLeft: "20px" }}>
            <li>Download your instance file using the button below</li>
            <li>Navigate to the RDF Upload section</li>
            <li>Upload the generated instance file to your knowledge graph</li>
            <li>Verify the instances in your workspace</li>
          </ol>
        </Alert>

        {/* ACTION BUTTONS */}
        <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            onClick={onGenerateAgain}
            disabled={loading}
          >
            Generate Again
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            onClick={onDownload}
            disabled={loading}
            size="large"
          >
            Download Instance File
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
