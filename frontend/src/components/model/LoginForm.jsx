import React, { useState } from "react";
import {
  FormControl,
  TextField,
  Button,
  Snackbar,
  FormHelperText,
} from "@mui/material";
import { Link } from "react-router-dom";
import MuiAlert from "@mui/material/Alert";
import OutlinedInput from "@mui/material/OutlinedInput";
import InputLabel from "@mui/material/InputLabel";
import InputAdornment from "@mui/material/InputAdornment";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import IconButton from "@mui/material/IconButton";
import axios from "axios";
import "./Form.css";
import ForgotPassword from "./ForgotPassword";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

export default function LoginForm({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [openForgotPassword, setOpenForgotPassword] = useState(false);
  const [openAlert, setOpenAlert] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleClickShowPassword = () => setShowPassword((show) => !show);

  const handleMouseDownPassword = (event) => {
    event.preventDefault();
  };

  const handleAlertClose = (event, reason) => {
    if (reason === "clickaway") return;
    setOpenAlert(false);
  };

  const handleLogin = () => {
    setLoginError("");
    setLoading(true);

    const requestBody = {
      email,
      password,
    };

  // keep a copy of email before clearing state
  const currentEmail = email;

  axios.post(`${API}/auth/login`, requestBody) 
      .then((response) => {
        const data = response?.data;

        if (data && data.access_token) {
          // Save token
          localStorage.setItem("token", data.access_token);

          // Build user object for the app/header
          const userData = {
            email: currentEmail,

            firstName: data.first_name || "",
            lastName: data.last_name || "",
          };

          if (typeof onLoginSuccess === "function") {
            onLoginSuccess(userData);
          }

          // clear form
          setEmail("");
          setPassword("");
          setLoginError("");
        } else {
          console.error("Invalid response:", response);
          setLoginError("Invalid email or password");
        }
      })
      .catch((error) => {
        console.error("Login error:", error);
        const msg =
          error?.response?.data?.detail ||
          error?.response?.data?.message ||
          "An error occurred during login. Please try again.";
        setLoginError(msg);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleOpenForgotPassword = () => {
    setOpenForgotPassword(true);
  };

  const handleCloseForgotPassword = () => {
    setOpenForgotPassword(false);
    setOpenAlert(true);
  };

  const handleCloseModal = () => {
    setOpenForgotPassword(false);
  };

  return (
    <div className="login__form">
      <FormControl className="formControl" style={{ marginBottom: "10px" }}>
        <TextField
          id="outlined-basic-email"
          label="Email"
          variant="outlined"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setLoginError("");
          }}
        />
      </FormControl>

      <FormControl className="formControl">
        <InputLabel htmlFor="outlined-adornment-password">
          Password
        </InputLabel>
        <OutlinedInput
          id="outlined-adornment-password"
          type={showPassword ? "text" : "password"}
          endAdornment={
            <InputAdornment position="end">
              <IconButton
                aria-label="toggle password visibility"
                onClick={handleClickShowPassword}
                onMouseDown={handleMouseDownPassword}
                edge="end"
              >
                {showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          }
          label="Password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setLoginError("");
          }}
        />
        {loginError && (
          <FormHelperText
            style={{
              color: "#D30A0A",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            {loginError}
          </FormHelperText>
        )}
      </FormControl>

      <Button
        variant="contained"
        size="large"
        style={{
          height: "45px",
          width: "80%",
          marginTop: "20px",
          backgroundColor: "#1d4ed8",
          color: "white",
        }}
        onClick={handleLogin}
      >
        Login
      </Button>

      <br />

      <Link
        to="#"
        onClick={(e) => {
          e.preventDefault();
          handleOpenForgotPassword();
        }}
      >
        Forgot Password?
      </Link>

      {/* Forgot Password dialog */}
      {openForgotPassword && (
        <ForgotPassword
          openForgotPassword={openForgotPassword}
          handleCloseForgotPassword={handleCloseModal}
          onSendSuccess={handleCloseForgotPassword}
        />
      )}

      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        open={openAlert}
        autoHideDuration={2000}
        onClose={handleAlertClose}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          Successfully sent the reset password link!
        </Alert>
      </Snackbar>
    </div>
  );
}
