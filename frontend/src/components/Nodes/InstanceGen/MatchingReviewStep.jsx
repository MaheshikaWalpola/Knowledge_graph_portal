import React, { useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Stack,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";

export default function MatchingReviewStep({
  analysisReport,
  userMappings,
  onUpdateMapping,
  onRemoveMapping,
  onProceedToGeneration,
  loading,
}) {
  const [editDialog, setEditDialog] = useState(null);
  const [selectedHeader, setSelectedHeader] = useState(null);
  const [selectedTerm, setSelectedTerm] = useState(null);

  const matched = analysisReport?.matched_headers || {};
  const unmatched = analysisReport?.unmatched_data_headers || [];
  const allSchemaTerms = analysisReport?.available_schema_terms || [];

  // Combine initial matched with user mappings
  const currentMappings = { ...matched, ...userMappings };

  const handleOpenEditDialog = (header) => {
    setSelectedHeader(header);
    setSelectedTerm(currentMappings[header] || "");
    setEditDialog(true);
  };

  const handleSaveMapping = () => {
    if (selectedHeader && selectedTerm) {
      onUpdateMapping(selectedHeader, selectedTerm);
    }
    setEditDialog(false);
    setSelectedHeader(null);
    setSelectedTerm(null);
  };

  const handleDeleteMapping = (header) => {
    onRemoveMapping(header);
  };

  const unmappedCount = unmatched.filter((h) => !currentMappings[h]).length;
  const mappedCount = Object.keys(currentMappings).length;

  return (
    <Box className="matching-review-step">
      <Typography variant="h6" gutterBottom>
        Step 3: Review & Correct Mappings
      </Typography>

      <Stack spacing={3}>
        {/* SUMMARY */}
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center" }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 2 }}>
              <Box>
                <Typography variant="body2" color="textSecondary">
                  Mapped Headers
                </Typography>
                <Typography variant="h5" color="success.main">
                  {mappedCount}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="textSecondary">
                  Unmapped Headers
                </Typography>
                <Typography variant="h5" color="warning.main">
                  {unmappedCount}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* CURRENT MAPPINGS */}
        {mappedCount > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CheckCircleIcon sx={{ color: "success.main" }} />
                Current Mappings
              </Typography>

              <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                      <TableCell><strong>Data Header</strong></TableCell>
                      <TableCell><strong>Schema Term</strong></TableCell>
                      <TableCell><strong>Source</strong></TableCell>
                      <TableCell align="center"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(currentMappings).map(([header, term]) => {
                      const isAutomatic = matched[header] === term;
                      return (
                        <TableRow key={header} hover>
                          <TableCell>{header}</TableCell>
                          <TableCell>
                            <Chip label={term} size="small" color="success" variant="outlined" />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={isAutomatic ? "Automatic" : "Manual"}
                              size="small"
                              variant="filled"
                              color={isAutomatic ? "default" : "warning"}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <IconButton
                              size="small"
                              onClick={() => handleOpenEditDialog(header)}
                              title="Edit mapping"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteMapping(header)}
                              title="Remove mapping"
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* UNMATCHED HEADERS */}
        {unmappedCount > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ErrorIcon sx={{ color: "warning.main" }} />
                Unmatched Headers
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Click on a header below to manually map it to a schema term
              </Typography>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
                {unmatched
                  .filter((h) => !currentMappings[h])
                  .map((header) => (
                    <Chip
                      key={header}
                      label={header}
                      onClick={() => handleOpenEditDialog(header)}
                      color="warning"
                      variant="outlined"
                      icon={<AddIcon />}
                    />
                  ))}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* INFO */}
        <Alert severity="info">
          <Typography variant="body2">
            💡 <strong>Tip:</strong> You can click on any header above to edit its
            schema term mapping. Click the delete icon to remove a mapping. All
            unmapped headers will be ignored when generating the instance.
          </Typography>
        </Alert>
      </Stack>

      {/* EDIT MAPPING DIALOG */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Map Header to Schema Term
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Data Header: <strong>{selectedHeader}</strong>
          </Typography>

          <Autocomplete
            options={allSchemaTerms}
            value={selectedTerm || null}
            onChange={(event, value) => setSelectedTerm(value || "")}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Schema Term"
                placeholder="Search or select a term"
                fullWidth
                sx={{ mt: 2 }}
              />
            )}
            freeSolo
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(false)}>Cancel</Button>
          <Button
            onClick={handleSaveMapping}
            variant="contained"
            disabled={!selectedTerm}
          >
            Save Mapping
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
