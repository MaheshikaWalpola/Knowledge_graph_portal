import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Profile.css";
import { getAvatarColorPair } from "../../utils/avatarUtils";

const API = import.meta.env.VITE_API_URL;

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export default function Profile({ user, onUserUpdated }) {
  const navigate = useNavigate();

  // Local editable fields (initialize from user)
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [editingName, setEditingName] = useState(false);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  // Schema Change History state
  const [historyList, setHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedSchemaFilter, setSelectedSchemaFilter] = useState("all");
  const [expandedEntries, setExpandedEntries] = useState({});
  const [deletingEntryId, setDeletingEntryId] = useState(null);

  // banners
  const [savingName, setSavingName] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Keep local state in sync if user changes (e.g., after login)
  useEffect(() => {
    setFirstName(user?.firstName || "");
    setLastName(user?.lastName || "");
    setEditingName(false);
  }, [user]);

  // Fetch schema change history
  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const res = await axios.get(`${API}/history/user/all`, {
        headers: authHeaders(),
      });
      setHistoryList(res.data?.entries || []);
    } catch (err) {
      setHistoryError(
        err?.response?.data?.detail || "Failed to load schema change history."
      );
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleExpandEntry = (entryId) => {
    setExpandedEntries((prev) => ({
      ...prev,
      [entryId]: !prev[entryId],
    }));
  };

  const handleDeleteHistoryEntry = async (entryId) => {
    if (!window.confirm("Are you sure you want to delete this history log?")) return;
    setDeletingEntryId(entryId);
    try {
      await axios.delete(`${API}/history/entry/${entryId}`, {
        headers: authHeaders(),
      });
      setHistoryList((prev) => prev.filter((e) => e.entry_id !== entryId));
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to delete history log.");
    } finally {
      setDeletingEntryId(null);
    }
  };

  const fullName = useMemo(() => {
    const f = (user?.firstName || "").trim();
    const l = (user?.lastName || "").trim();
    const name = `${f} ${l}`.trim();
    return name || user?.email || "";
  }, [user]);

  const initials = useMemo(() => {
    const f = (user?.firstName || "").trim().charAt(0).toUpperCase();
    const l = (user?.lastName || "").trim().charAt(0).toUpperCase();
    if (f || l) return `${f}${l}`;
    return (user?.email || "U").substring(0, 2).toUpperCase();
  }, [user]);

  const avatarColors = useMemo(() => {
    if (!user) return { light: "#3498db", dark: "#2980b9" };
    return getAvatarColorPair(user.email || `${user.firstName}${user.lastName}`);
  }, [user]);

  // Extract distinct schemas for the filter dropdown
  const distinctSchemas = useMemo(() => {
    const map = new Map();
    historyList.forEach((item) => {
      if (item.schema_id && !map.has(item.schema_id)) {
        map.set(item.schema_id, item.schema_name || item.schema_id);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [historyList]);

  // Filtered history list
  const filteredHistory = useMemo(() => {
    if (selectedSchemaFilter === "all") return historyList;
    return historyList.filter((item) => item.schema_id === selectedSchemaFilter);
  }, [historyList, selectedSchemaFilter]);

  const validateName = () => {
    if (!firstName.trim()) return "First name is required.";
    if (!lastName.trim()) return "Last name is required.";
    if (firstName.trim().length > 50 || lastName.trim().length > 50) {
      return "Name is too long.";
    }
    return "";
  };

  const saveName = async () => {
    setError("");
    setOk("");

    if (!user) {
      setError("You must be logged in to update your name.");
      return;
    }

    const msg = validateName();
    if (msg) {
      setError(msg);
      return;
    }

    setSavingName(true);
    try {
      const res = await axios.put(
        `${API}/user/profile`,
        { firstName: firstName.trim(), lastName: lastName.trim() },
        { headers: authHeaders() }
      );

      const updatedUser = res.data?.user || {
        ...user,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };

      setOk("Name updated successfully.");
      setEditingName(false);

      if (onUserUpdated) onUserUpdated(updatedUser);
    } catch (e) {
      setError(
        e?.response?.data?.detail ||
          e?.response?.data?.message ||
          e?.message ||
          "Failed to update name."
      );
    } finally {
      setSavingName(false);
    }
  };

  const cancelNameEdit = () => {
    setError("");
    setOk("");
    setFirstName(user?.firstName || "");
    setLastName(user?.lastName || "");
    setEditingName(false);
  };

  const submitChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setOk("");

    if (!user) {
      setError("You must be logged in to change your password.");
      return;
    }
    if (!currentPassword || !newPassword) {
      setError("Please fill current password and new password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSavingPwd(true);
    try {
      await axios.post(
        `${API}/user/change-password`,
        { currentPassword, newPassword },
        { headers: authHeaders() }
      );

      setOk("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (e2) {
      setError(
        e2?.response?.data?.detail ||
          e2?.response?.data?.message ||
          e2?.message ||
          "Failed to update password."
      );
    } finally {
      setSavingPwd(false);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  if (!user) {
    return (
      <div className="profile-container animate-fadeIn">
        <div className="profile-card">
          <div className="profile-header">
            <h2 className="profile-title">Profile</h2>
            <p className="profile-sub">Please sign in to view your profile.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-container animate-fadeIn">
      <div className="profile-card">
        <div className="profile-header">
          <h2 className="profile-title">Profile</h2>
          <p className="profile-sub">Manage your account information and view schema history logs.</p>
        </div>

        {/* Dynamic Avatar Banner Section */}
        <div className="profile-banner-card">
          <div
            className="profile-avatar-glow"
            style={{
              "--avatar-color-light": avatarColors.light,
              "--avatar-color-dark": avatarColors.dark,
              "--avatar-shadow-25": `${avatarColors.light}40`,
              "--avatar-shadow-45": `${avatarColors.light}73`,
            }}
          >
            <span className="profile-avatar-initials">{initials}</span>
          </div>
          <div className="profile-banner-info">
            <h3 className="profile-banner-name">{fullName}</h3>
            <span className="profile-banner-email">{user.email}</span>
          </div>
        </div>

        {(error || ok) && (
          <div style={{ marginTop: 12 }}>
            {error && <div className="error-banner">{error}</div>}
            {ok && <div className="ok-banner">{ok}</div>}
          </div>
        )}

        {/* Account Details */}
        <div className="section">
          <div className="section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Account
          </div>

          <div className="grid">
            {/* Name field */}
            <div className="field">
              <div className="field-header">
                <svg className="field-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                <label className="label">Name</label>
              </div>

              {!editingName ? (
                <div className="row-between">
                  <div className="value">{fullName}</div>
                  <button
                    type="button"
                    className="btn-outline-small"
                    onClick={() => {
                      setError("");
                      setOk("");
                      setEditingName(true);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "5px" }}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    Edit
                  </button>
                </div>
              ) : (
                <div className="edit-mode-container">
                  <div className="name-grid">
                    <input
                      className="input"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>

                  <div className="actions">
                    <button
                      type="button"
                      className="btn-outline-small cancel"
                      onClick={cancelNameEdit}
                      disabled={savingName}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-small"
                      onClick={saveName}
                      disabled={savingName}
                    >
                      {savingName ? (
                        "Saving..."
                      ) : (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}><polyline points="20 6 9 17 4 12"></polyline></svg>
                          Save
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Email field */}
            <div className="field read-only">
              <div className="field-header">
                <svg className="field-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                <label className="label">Email</label>
              </div>
              <div className="row-between">
                <div className="value email-value">{user.email}</div>
                <div className="lock-badge">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  Locked
                </div>
              </div>
              <div className="hint">Email cannot be changed.</div>
            </div>
          </div>
        </div>

        {/* ─── Schema Change History Logs Section ─────────── */}
        <div className="section history-section">
          <div className="history-section-header">
            <div className="section-title" style={{ margin: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Schema Change History
            </div>

            {/* Controls: Filter & Refresh */}
            <div className="history-controls">
              {distinctSchemas.length > 0 && (
                <div className="history-filter-wrapper">
                  <label className="history-filter-label">Filter:</label>
                  <select
                    className="history-filter-select"
                    value={selectedSchemaFilter}
                    onChange={(e) => setSelectedSchemaFilter(e.target.value)}
                  >
                    <option value="all">All Ontologies ({historyList.length})</option>
                    {distinctSchemas.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                className={`history-refresh-btn ${loadingHistory ? "loading" : ""}`}
                onClick={fetchHistory}
                disabled={loadingHistory}
                title="Refresh history"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>{loadingHistory ? "Loading..." : "Refresh"}</span>
              </button>
            </div>
          </div>

          <p className="section-desc">
            Granular change logs recorded every time you save modifications on the Ontology Canvas.
          </p>

          {historyError && (
            <div className="error-banner" style={{ marginBottom: "16px" }}>
              {historyError}
            </div>
          )}

          {/* History Timeline List */}
          {loadingHistory && historyList.length === 0 ? (
            <div className="history-loading-state">
              <div className="history-spinner" />
              <span>Loading change history...</span>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="history-empty-card">
              <div className="history-empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <h4>No Schema History Recorded Yet</h4>
              <p>
                When you create or modify an ontology on the Canvas and press <strong>Save</strong> or <strong>Ctrl+S</strong>, version change logs will appear here.
              </p>
              <button
                type="button"
                className="btn-small"
                style={{ marginTop: "12px" }}
                onClick={() => navigate("/canvas")}
              >
                Open Canvas Editor
              </button>
            </div>
          ) : (
            <div className="history-timeline">
              {filteredHistory.map((item) => {
                const isExpanded = !!expandedEntries[item.entry_id];
                const changes = item.changes || {};
                const addedCount = (changes.nodes_added?.length || 0) + (changes.edges_added?.length || 0);
                const removedCount = (changes.nodes_removed?.length || 0) + (changes.edges_removed?.length || 0);
                const modifiedCount = (changes.nodes_modified?.length || 0) + (changes.edges_modified?.length || 0);

                return (
                  <div key={item.entry_id} className="history-card">
                    {/* Top Row: Schema Name, Version, Action, Timestamp */}
                    <div className="history-card-top">
                      <div className="history-card-title-group">
                        <span className="history-version-badge">
                          v{item.version || 1}
                        </span>
                        <span
                          className={`history-action-badge ${
                            item.action === "created"
                              ? "created"
                              : item.action === "imported"
                              ? "imported"
                              : "updated"
                          }`}
                        >
                          {item.action || "updated"}
                        </span>
                        <h4 className="history-schema-title">
                          {item.schema_name || item.schema_id}
                        </h4>
                      </div>

                      <div className="history-meta-right">
                        <span className="history-timestamp">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          {formatDate(item.saved_at)}
                        </span>

                        <button
                          type="button"
                          className="history-delete-btn"
                          onClick={() => handleDeleteHistoryEntry(item.entry_id)}
                          disabled={deletingEntryId === item.entry_id}
                          title="Delete this history record"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Summary & Pills */}
                    <div className="history-card-body">
                      <div className="history-summary-text">
                        {changes.summary || "Schema updated"}
                      </div>

                      <div className="history-pills-row">
                        {addedCount > 0 && (
                          <span className="ce-diff-pill added">
                            +{addedCount} Added
                          </span>
                        )}
                        {removedCount > 0 && (
                          <span className="ce-diff-pill removed">
                            -{removedCount} Removed
                          </span>
                        )}
                        {modifiedCount > 0 && (
                          <span className="ce-diff-pill modified">
                            ~{modifiedCount} Modified
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expandable Details */}
                    {isExpanded && (
                      <div className="history-expanded-details">
                        {changes.nodes_added?.map((n) => (
                          <div key={`hna_${n.id}`} className="ce-diff-item add">
                            <span className="ce-diff-tag add">+</span>
                            <span className="ce-diff-item-text">
                              Added Node: <strong>{n.label || n.id}</strong> ({n.type})
                            </span>
                          </div>
                        ))}
                        {changes.nodes_removed?.map((n) => (
                          <div key={`hnr_${n.id}`} className="ce-diff-item del">
                            <span className="ce-diff-tag del">-</span>
                            <span className="ce-diff-item-text">
                              Removed Node: <strong>{n.label || n.id}</strong>
                            </span>
                          </div>
                        ))}
                        {changes.nodes_modified?.map((m, idx) => (
                          <div key={`hnm_${m.id}_${idx}`} className="ce-diff-item mod">
                            <span className="ce-diff-tag mod">~</span>
                            <span className="ce-diff-item-text">
                              Modified {m.field}: <del>{m.old || "none"}</del> → <ins>{m.new}</ins>
                            </span>
                          </div>
                        ))}
                        {changes.edges_added?.map((e) => (
                          <div key={`hea_${e.id}`} className="ce-diff-item add">
                            <span className="ce-diff-tag add">+</span>
                            <span className="ce-diff-item-text">
                              Added Relation: <strong>{e.edgeType}</strong>
                            </span>
                          </div>
                        ))}
                        {changes.edges_removed?.map((e) => (
                          <div key={`her_${e.id}`} className="ce-diff-item del">
                            <span className="ce-diff-tag del">-</span>
                            <span className="ce-diff-item-text">
                              Removed Relation: <strong>{e.edgeType}</strong>
                            </span>
                          </div>
                        ))}
                        {changes.edges_modified?.map((e, idx) => (
                          <div key={`hem_${e.id}_${idx}`} className="ce-diff-item mod">
                            <span className="ce-diff-tag mod">~</span>
                            <span className="ce-diff-item-text">
                              Relation Changed: <del>{e.old}</del> → <ins>{e.new}</ins>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bottom Actions */}
                    <div className="history-card-footer">
                      <button
                        type="button"
                        className="history-toggle-details-btn"
                        onClick={() => toggleExpandEntry(item.entry_id)}
                      >
                        <span>{isExpanded ? "Hide Details" : "View Details"}</span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          style={{
                            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        className="history-open-canvas-btn"
                        onClick={() =>
                          navigate(`/canvas?schema_id=${item.schema_id}`, {
                            state: { originalName: item.schema_name },
                          })
                        }
                        title="Open this schema on Canvas"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        <span>Open on Canvas</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Change password */}
        <div className="section">
          <div className="section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Change password
          </div>

          <form className="form" onSubmit={submitChangePassword}>
            <div className="password-input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </span>
              <input
                className="input input-with-icon"
                type={showPasswords ? "text" : "password"}
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPasswords(!showPasswords)}
                title={showPasswords ? "Hide password" : "Show password"}
              >
                {showPasswords ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            
            <div className="password-input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><key x="0" y="0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></key></svg>
              </span>
              <input
                className="input input-with-icon"
                type={showPasswords ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPasswords(!showPasswords)}
                title={showPasswords ? "Hide password" : "Show password"}
              >
                {showPasswords ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="password-input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </span>
              <input
                className="input input-with-icon"
                type={showPasswords ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPasswords(!showPasswords)}
                title={showPasswords ? "Hide password" : "Show password"}
              >
                {showPasswords ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="actions">
              <button className="btn" type="submit" disabled={savingPwd}>
                {savingPwd ? (
                  "Saving..."
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    Update password
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
