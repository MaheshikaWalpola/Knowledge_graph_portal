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
import WarningIcon from "@mui/icons-material/Warning";

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
  const [dialogMode, setDialogMode] = useState("header_to_term"); // "header_to_term" or "term_to_header"

  const matched = analysisReport?.matched_headers || {};
  const unmatched = analysisReport?.unmatched_data_headers || [];
  const allSchemaTerms = analysisReport?.available_schema_terms || [];

  // Use userMappings directly as currentMappings
  const currentMappings = userMappings;

  // Dynamic filter for unmatched headers (headers not mapped yet)
  const unmatchedHeadersList = unmatched.filter((h) => !currentMappings[h]);
  const unmappedCount = unmatchedHeadersList.length;

  // Dynamic filter for missing schema terms (terms not present as values in mappings yet)
  const missingTermsList = (analysisReport?.missing_schema_terms || []).filter(
    (t) => !Object.values(currentMappings).includes(t)
  );
  const missingCount = missingTermsList.length;

  const mappedCount = Object.keys(currentMappings).length;

  const handleOpenEditDialog = (header) => {
    setDialogMode("header_to_term");
    setSelectedHeader(header);
    setSelectedTerm(currentMappings[header] || "");
    setEditDialog(true);
  };

  const handleOpenMapTermDialog = (term) => {
    setDialogMode("term_to_header");
    setSelectedTerm(term);
    const headerForTerm = Object.keys(currentMappings).find(h => currentMappings[h] === term);
    setSelectedHeader(headerForTerm || "");
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
                {unmatchedHeadersList.map((header) => (
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

        {/* MISSING SCHEMA TERMS */}
        {missingCount > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <WarningIcon sx={{ color: "error.main" }} />
                Missing Schema Terms
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Click on a missing term below to map it to a CSV header name
              </Typography>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
                {missingTermsList.map((term) => (
                  <Chip
                    key={term}
                    label={term}
                    onClick={() => handleOpenMapTermDialog(term)}
                    color="error"
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
            <strong>Tip:</strong> You can click on any header above to edit its
            schema term mapping. Click the delete icon to remove a mapping. All
            unmapped headers will be ignored when generating the instance.
          </Typography>
        </Alert>
      </Stack>

      {/* EDIT MAPPING DIALOG */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialogMode === "header_to_term" ? "Map Header to Schema Term" : "Map Schema Term to CSV Header"}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {dialogMode === "header_to_term" ? (
            <>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Data Header: <strong>{selectedHeader}</strong>
              </Typography>
              <Autocomplete
                options={allSchemaTerms}
                value={selectedTerm || null}
                onChange={(event, value) => setSelectedTerm(value || "")}
                onInputChange={(event, newInputValue) => setSelectedTerm(newInputValue || "")}
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
            </>
          ) : (
            <>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Schema Term: <strong>{selectedTerm}</strong>
              </Typography>
              <Autocomplete
                options={unmatched}
                value={selectedHeader || null}
                onChange={(event, value) => setSelectedHeader(value || "")}
                onInputChange={(event, newInputValue) => setSelectedHeader(newInputValue || "")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select or Type Data Header"
                    placeholder="Search or select a CSV header, or type a custom name"
                    fullWidth
                    sx={{ mt: 2 }}
                  />
                )}
                freeSolo
                fullWidth
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(false)}>Cancel</Button>
          <Button
            onClick={handleSaveMapping}
            variant="contained"
            disabled={dialogMode === "header_to_term" ? !selectedTerm : !selectedHeader}
          >
            Save Mapping
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
