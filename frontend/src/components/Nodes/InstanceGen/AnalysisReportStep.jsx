import React from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import WarningIcon from "@mui/icons-material/Warning";

export default function AnalysisReportStep({
  report,
  onProceedToReview,
  onSkipReviewAndGenerate,
  loading,
}) {
  const [openDetails, setOpenDetails] = React.useState(null);

  const matched = report?.matched_headers || {};
  const unmatched = report?.unmatched_data_headers || [];
  const missingSchemaTerm = report?.missing_schema_terms || [];

  const matchCount = Object.keys(matched).length;
  const unmatchedCount = unmatched.length;
  const missingCount = missingSchemaTerm.length;

  const totalHeaders = report?.data_headers_count || 0;
  const processedHeaders = matchCount + unmatchedCount;
  const percent = totalHeaders > 0 ? Math.round((processedHeaders / totalHeaders) * 100) : 0;

  return (
    <Box className="analysis-report-step">
      <Typography variant="h6" gutterBottom>
        Step 2: Analysis Report
      </Typography>

      {loading && (
        <Box sx={{ width: "100%", mb: 3, p: 2, bgcolor: "#f8f9fa", borderRadius: 2, border: "1px solid #e9ecef" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 500 }}>
              Analyzing and matching headers... ({processedHeaders} of {totalHeaders} columns)
            </Typography>
            <Typography variant="body2" fontWeight="bold" color="primary">
              {percent}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 4 }} />
          {report?.matching_method && (
            <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: "block", fontStyle: "italic" }}>
              Current Phase: {report.matching_method}
            </Typography>
          )}
        </Box>
      )}

      <Stack spacing={3}>
        {/* SUMMARY CARDS */}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 2 }}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mb: 1 }}>
                <CheckCircleIcon sx={{ color: "success.main" }} />
                <Typography variant="h6">Matched Headers</Typography>
              </Box>
              <Typography variant="h4" color="success.main">
                {matchCount}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Data headers matched to schema terms
              </Typography>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ textAlign: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mb: 1 }}>
                <ErrorIcon sx={{ color: "warning.main" }} />
                <Typography variant="h6">Unmatched Headers</Typography>
              </Box>
              <Typography variant="h4" color="warning.main">
                {unmatchedCount}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Data headers without schema match
              </Typography>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ textAlign: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mb: 1 }}>
                <WarningIcon sx={{ color: "error.main" }} />
                <Typography variant="h6">Missing Terms</Typography>
              </Box>
              <Typography variant="h4" color="error.main">
                {missingCount}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Schema terms without data headers
              </Typography>
            </CardContent>
          </Card>
        </Box>

        {/* MATCHED HEADERS TABLE */}
        {matchCount > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CheckCircleIcon sx={{ color: "success.main" }} />
                Matched Headers
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                These data headers were successfully matched to schema terms
              </Typography>

              <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                      <TableCell><strong>Data Header</strong></TableCell>
                      <TableCell><strong>Matched Schema Term</strong></TableCell>
                      <TableCell align="center"><strong>Confidence</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(matched).map(([header, term]) => (
                      <TableRow key={header} hover>
                        <TableCell>{header}</TableCell>
                        <TableCell>
                          <Chip label={term} size="small" color="success" variant="outlined" />
                        </TableCell>
                        <TableCell align="center">
                          <Chip label="High" size="small" color="success" variant="filled" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* UNMATCHED HEADERS */}
        {unmatchedCount > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ErrorIcon sx={{ color: "warning.main" }} />
                Unmatched Data Headers
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                These data headers could not be automatically matched to schema terms.
                You can manually map them in the next step.
              </Typography>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
                {unmatched.map((header) => (
                  <Chip
                    key={header}
                    label={header}
                    variant="outlined"
                    color="warning"
                    onDelete={() => {}} // can be empty
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
                These schema terms do not have corresponding data headers.
                They will not be included in the generated instance.
              </Typography>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
                {missingSchemaTerm.map((term) => (
                  <Chip
                    key={term}
                    label={term}
                    variant="outlined"
                    color="error"
                    onDelete={() => {}} // can be empty
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* OPTIONS */}
        <Alert severity="info">
          <Typography variant="subtitle2" gutterBottom>
            What Next?
          </Typography>
          <Typography variant="body2">
            Choose one of two options below:
          </Typography>
          <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
            <li>
              <strong>Review Matches:</strong> Manually review and correct the
              automatic matches in detail
            </li>
            <li>
              <strong>Skip Review:</strong> Proceed directly to generate the
              instance using the automatic matches
            </li>
          </ul>
        </Alert>
      </Stack>

      {/* ACTION BUTTONS - moved to main component footer */}
    </Box>
  );
}
