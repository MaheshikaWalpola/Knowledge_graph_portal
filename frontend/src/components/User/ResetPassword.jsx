import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import "./ResetPassword.css";

const API = import.meta.env.VITE_API_URL;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = useMemo(() => params.get("token") || "", [params]);

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setOk("");

    if (!token) {
      setError("Missing reset token. Please use the link from the email.");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      await axios.post(
        `${API}/user/resetpassword`,
        { token, newPassword },
        { headers: { "Content-Type": "application/json" } }
      );

      setOk("Password reset successful. You can now sign in.");
      setNewPassword("");
      setConfirm("");

      setTimeout(() => navigate("/"), 900);
    } catch (e2) {
      setError(
        e2?.response?.data?.detail ||
          e2?.response?.data?.message ||
          e2?.message ||
          "Failed to reset password."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rp-container">
      <div className="rp-card">
        <div className="rp-header">
          <h2 className="rp-title">Reset Password</h2>
          <p className="rp-sub">Set a new password for your account.</p>
        </div>

        {(error || ok) && (
          <div style={{ marginTop: 8 }}>
            {error && <div className="error-banner">{error}</div>}
            {ok && <div className="ok-banner">{ok}</div>}
          </div>
        )}

        <form className="rp-form" onSubmit={submit}>
          <input
            className="rp-input"
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            className="rp-input"
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <div className="rp-actions">
            <button className="rp-btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Reset password"}
            </button>
          </div>
        </form>

        {!token && (
          <div className="rp-hint">
            Tip: open the reset link from the email. It contains a token.
          </div>
        )}
      </div>
    </div>
  );
}
