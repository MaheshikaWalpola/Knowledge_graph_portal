import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  Container,
  Typography,
  Box,
  TextField,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import { useNavigate } from "react-router-dom";
import "./MyOntologies.css";

const API = import.meta.env.VITE_API_URL;

export default function MyOntologies({ onOpenAuth }) {
  const [schemas, setSchemas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [schemaToDelete, setSchemaToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      if (onOpenAuth) onOpenAuth("/my-ontologies");
      navigate("/");
      return;
    }
    fetchSchemas();
  }, [token, navigate, onOpenAuth]);

  const fetchSchemas = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/workspace/schemas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Optionally filter out "base"
      const list = (res.data?.schemas || []).filter(
        (s) => s.upload_mode !== "base"
      );
      setSchemas(list);
    } catch (e) {
      console.error("Failed to fetch schemas", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!schemaToDelete) return;
    setDeleteLoading(true);
    try {
      await axios.delete(`${API}/workspace/schema/${schemaToDelete.schema_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSchemas((prev) =>
        prev.filter((s) => s.schema_id !== schemaToDelete.schema_id)
      );
      setDeleteModalOpen(false);
      setSchemaToDelete(null);
    } catch (e) {
      console.error("Delete failed", e);
      alert("Failed to delete the ontology. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const filteredSchemas = useMemo(() => {
    if (!search.trim()) return schemas;
    const term = search.toLowerCase();
    return schemas.filter((s) => s.name?.toLowerCase().includes(term));
  }, [schemas, search]);

  return (
    <div className="kg-container">
      <div className="kg-card">
        <div className="kg-header">
          <p className="kg-title">My Ontologies</p>
          <p className="kg-subtitle">
            Manage, search, and securely delete your uploaded ontologies from your personal workspace.
          </p>
        </div>

      <Box sx={{ mb: 4, display: "flex", gap: 2, alignItems: "center" }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Search ontologies by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ color: "text.secondary", mr: 1 }} />,
            sx: { borderRadius: "30px", background: "var(--bg-glass)" }
          }}
          sx={{
            background: "transparent",
            "& .MuiOutlinedInput-root": {
              borderRadius: "30px",
            }
          }}
        />
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress sx={{ color: "var(--accent-primary)" }} />
        </Box>
      ) : filteredSchemas.length === 0 ? (
        <Box className="empty-state">
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {schemas.length === 0 ? "You haven't uploaded any ontologies yet" : "No ontologies match your search"}
          </Typography>
          {schemas.length === 0 && (
            <Button
              variant="outlined"
              onClick={() => navigate("/workspace")}
              sx={{ mt: 2, borderRadius: "20px", textTransform: "none" }}
            >
              Go to Workspace
            </Button>
          )}
        </Box>
      ) : (
        <Grid container spacing={3}>
          {filteredSchemas.map((schema) => (
            <Grid item xs={12} sm={6} md={4} key={schema.schema_id}>
              <Card
                className="ontology-card"
                elevation={0}
                onClick={() => navigate(`/canvas?schema_id=${schema.schema_id}`, { state: { originalName: schema.name } })}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" fontWeight="600" noWrap gutterBottom>
                    {schema.name}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
                    <Chip
                      label={
                        schema.upload_mode === "separate"
                          ? "Schema + Instances"
                          : "Combined File"
                      }
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ fontSize: "0.75rem", fontWeight: 500 }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Uploaded: {new Date(schema.created_at).toLocaleDateString()}
                  </Typography>
                </CardContent>
                <CardActions sx={{ justifyContent: "flex-end", pt: 0, px: 2, pb: 2 }}>
                  <IconButton
                    color="error"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSchemaToDelete(schema);
                      setDeleteModalOpen(true);
                    }}
                    title="Delete Ontology"
                  >
                    <DeleteIcon />
                  </IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteModalOpen} onClose={() => !deleteLoading && setDeleteModalOpen(false)}>
        <DialogTitle>Delete Ontology?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{schemaToDelete?.name}</strong>? 
            This will permanently remove the schema and all its associated data from the Knowledge Graph database.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setDeleteModalOpen(false)}
            disabled={deleteLoading}
            variant="outlined"
            sx={{ textTransform: "none", borderRadius: "8px" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            disabled={deleteLoading}
            color="error"
            variant="contained"
            sx={{ textTransform: "none", borderRadius: "8px", boxShadow: "none" }}
            autoFocus
          >
            {deleteLoading ? <CircularProgress size={24} color="inherit" /> : "Delete Permanently"}
          </Button>
        </DialogActions>
      </Dialog>
      </div>
    </div>
  );
}
