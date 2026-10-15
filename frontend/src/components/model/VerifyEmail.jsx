import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CircularProgress, Box, Typography } from "@mui/material";
import axios from "axios";
import { API } from "../../config";


export default function VerifyEmail({ onLoginSuccess }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [status, setStatus] = useState("loading"); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState("");

  // IMPORTANT: prevent double call in React StrictMode
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    axios
      .get(`${API}/auth/verify-email`, { params: { token } })
      .then((res) => {
        console.log("verify-email response:", res.data);
        const data = res.data;

        if (data.status === "ok") {
          setStatus("success");
          setMessage(data.message || "Email verified successfully.");

          // store JWT
          if (data.access_token) {
            localStorage.setItem("token", data.access_token);
          }

          // update header (user in App.jsx)
          if (typeof onLoginSuccess === "function" && data.user) {
            onLoginSuccess(data.user);
          }

          // little delay to show success, then go home
          setTimeout(() => {
            navigate("/");
          }, 2000);
        } else {
          setStatus("error");
          setMessage(data.message || "Verification failed.");
        }
      })
      .catch((err) => {
        console.error("verify-email error:", err);
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          "Verification link is invalid or has expired.";
        setStatus("error");
        setMessage(msg);
      });
  }, [location.search, navigate, onLoginSuccess]);

  return (
    <Box
      sx={{
        mt: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        px: 2,
      }}
    >
      {status === "loading" && (
        <>
          <CircularProgress />
          <Typography sx={{ mt: 2 }} variant="h6">
            Verifying your email…
          </Typography>
          <Typography sx={{ mt: 1, color: "text.secondary" }}>
            Please wait, we are activating your account.
          </Typography>
        </>
      )}

      {status === "success" && (
        <>
          <Typography variant="h5" sx={{ mb: 1 }}>
            Email verified 🎉
          </Typography>
          <Typography sx={{ color: "text.secondary" }}>
            Your account is now activated. Redirecting you to the home page…
          </Typography>
        </>
      )}

      {status === "error" && (
        <>
          <Typography variant="h5" sx={{ mb: 1, color: "error.main" }}>
            Verification failed
          </Typography>
          <Typography sx={{ color: "text.secondary" }}>
            {message}
          </Typography>
        </>
      )}
    </Box>
  );
}
