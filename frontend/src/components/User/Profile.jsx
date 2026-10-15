import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./Profile.css";
import { API } from "../../config";


const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export default function Profile({ user, onUserUpdated }) {
  // Local editable fields (initialize from user)
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [editingName, setEditingName] = useState(false);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

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

  const fullName = useMemo(() => {
    const f = (user?.firstName || "").trim();
    const l = (user?.lastName || "").trim();
    const name = `${f} ${l}`.trim();
    return name || user?.email || "";
  }, [user]);

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

  if (!user) {
    return (
      <div className="profile-container">
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
    <div className="profile-container">
      <div className="profile-card">
        <div className="profile-header">
          <h2 className="profile-title">Profile</h2>
          <p className="profile-sub">Manage your account information.</p>
        </div>

        {(error || ok) && (
          <div style={{ marginTop: 8 }}>
            {error && <div className="error-banner">{error}</div>}
            {ok && <div className="ok-banner">{ok}</div>}
          </div>
        )}

        {/* Account */}
        <div className="section">
          <div className="section-title">Account</div>

          <div className="grid">
            {/* Name (editable) */}
            <div className="field">
              <label className="label">Name</label>

              {!editingName ? (
                <div className="row-between">
                  <div className="value">{fullName}</div>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      setError("");
                      setOk("");
                      setEditingName(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <>
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
                      className="btn-outline"
                      onClick={cancelNameEdit}
                      disabled={savingName}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={saveName}
                      disabled={savingName}
                    >
                      {savingName ? "Saving..." : "Save"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Email (read-only) */}
            <div className="field">
              <label className="label">Email</label>
              <div className="value">{user.email}</div>
              <div className="hint">Email cannot be changed.</div>
            </div>
          </div>
        </div>

        {/* Change password */}
        <div className="section">
          <div className="section-title">Change password</div>

          <form className="form" onSubmit={submitChangePassword}>
            <div className="password-input-wrapper">
              <input
                className="input"
                style={{ width: "100%", paddingRight: "40px" }}
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
              <input
                className="input"
                style={{ width: "100%", paddingRight: "40px" }}
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
              <input
                className="input"
                style={{ width: "100%", paddingRight: "40px" }}
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
                {savingPwd ? "Saving..." : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}