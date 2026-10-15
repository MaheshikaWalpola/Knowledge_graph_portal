import React, { useState } from "react";
import {
  FormControl,
  TextField,
  Button,
  Snackbar,
  FormHelperText,
  InputLabel,
  OutlinedInput,
  InputAdornment,
  IconButton,
  Box,
  Typography,
} from "@mui/material";
import MuiAlert from "@mui/material/Alert";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import EmailIcon from "@mui/icons-material/Email";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Form.css";
import { API } from "../../config";


const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

export default function RegistrationForm({ onRegisterSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cpassword, setCPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [openAlert, setOpenAlert] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const navigate = useNavigate();

  const termsAndConditionsUrl = "/termsandconditions";

  // ------- validation helpers -------
  const isValidTermsAccepted = (termsAccepted) => termsAccepted;

  const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);

  const isValidPassword = (password) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%#*?&])[A-Za-z\d@$!%#*?&]{8,}$/.test(
      password
    );

  const isMatchingPassword = (password, cpassword) => password === cpassword;

  const isValidFirstName = (firstName) =>
    typeof firstName === "string" && firstName.trim().length > 0;

  const isValidLastName = (lastName) =>
    typeof lastName === "string" && lastName.trim().length > 0;

  // ------- handlers -------

  const handleClickShowPassword = () => setShowPassword((show) => !show);
  const handleMouseDownPassword = (event) => {
    event.preventDefault();
  };

  const handleConfirmPwd = () => setShowConfirmPassword((show) => !show);
  const handleConfirmPwdMouseDown = (event) => {
    event.preventDefault();
  };

  const handleAlertClose = (event, reason) => {
    if (reason === "clickaway") return;
    setOpenAlert(false);
  };

  const handleRegistration = () => {
    setSubmitted(true);
    setErrorMessage("");
console.log("testing")
    // client-side validations
    if (!isValidFirstName(firstName)) return;
    if (!isValidLastName(lastName)) return;
    if (!isValidEmail(email)) return;
    if (!isValidPassword(password)) return;
    if (!isMatchingPassword(password, cpassword)) return;
    if (!termsAccepted) return;

    const requestBody = {
      firstName,
      lastName,
      email,
      password,
    };
    
axios.post(`${API}/auth/register`, requestBody)
  .then((response) => {
    if (response && response.data) {
      const { status, message } = response.data;

      if (status === "ok") {
        // show success
        setRegisteredEmail(email);
        setIsRegistered(true);
        setOpenAlert(true);
        setErrorMessage("");

        // reset form
        setFirstName("");
        setLastName("");
        setEmail("");
        setPassword("");
        setCPassword("");
        setTermsAccepted(false);
        setSubmitted(false);
      } else {
        console.error("Unexpected response:", response.data);
        setErrorMessage(message || "User already exists");
        setOpenAlert(false);
      }
    } else {
      console.error("Invalid response:", response);
      setErrorMessage("Something went wrong. Please try again.");
      setOpenAlert(false);
    }
  })
  .catch((error) => {
    console.error("Registration error:", error);
    const msg =
      error?.response?.data?.detail || // FastAPI HTTPException
      error?.response?.data?.message || // just in case
      "An error occurred during registration. Please try again.";
    setErrorMessage(msg);
    setOpenAlert(false);
  });
  };

  if (isRegistered) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          padding: "30px 20px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 80,
            height: 80,
            borderRadius: "50%",
            backgroundColor: "#dbeafe",
            color: "#1d4ed8",
            marginBottom: "24px",
            boxShadow: "0 4px 14px rgba(29, 78, 216, 0.15)",
          }}
        >
          <EmailIcon sx={{ fontSize: 40 }} />
        </Box>

        <Typography
          variant="h5"
          component="h2"
          sx={{
            fontWeight: "bold",
            color: "#1e293b",
            marginBottom: "16px",
            fontFamily: "'Outfit', 'Inter', sans-serif",
          }}
        >
          Verify Your Email
        </Typography>

        <Typography
          variant="body1"
          sx={{
            color: "#475569",
            lineHeight: 1.6,
            marginBottom: "20px",
            fontSize: "15px",
          }}
        >
          Thank you for registering! We've sent a verification link to{" "}
          <strong style={{ color: "#0f172a" }}>{registeredEmail}</strong>.
          Please click the link in the email to activate your account.
        </Typography>

        <Box
          sx={{
            backgroundColor: "#fef3c7",
            borderLeft: "4px solid #d97706",
            borderRadius: "6px",
            padding: "12px 16px",
            marginBottom: "28px",
            textAlign: "left",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: "#92400e",
              fontWeight: 500,
              lineHeight: 1.5,
            }}
          >
            <strong>Note:</strong> If you don't receive the email within a few
            minutes, please check your <strong>Junk</strong> or <strong>Spam</strong> folder.
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => {
            if (typeof onRegisterSuccess === "function") {
              onRegisterSuccess(registeredEmail);
            } else {
              navigate("/");
            }
          }}
          sx={{
            height: "45px",
            width: "100%",
            backgroundColor: "#1d4ed8",
            color: "white",
            fontWeight: 600,
            borderRadius: "8px",
            textTransform: "none",
            fontSize: "16px",
            boxShadow: "0 4px 12px rgba(29, 78, 216, 0.2)",
            "&:hover": {
              backgroundColor: "#1e40af",
            },
          }}
        >
          Got it, thank you!
        </Button>
      </Box>
    );
  }

  return (
    <form className="login__form" onSubmit={(e) => { e.preventDefault(); handleRegistration(); }}>
      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
      >
        <TextField
          id="outlined-basic-firstName"
          label="First Name"
          variant="outlined"
          value={firstName}
          onChange={(event) => {
            setFirstName(event.target.value);
            setErrorMessage("");
          }}
          helperText={
            submitted && !isValidFirstName(firstName)
              ? "Invalid First Name"
              : ""
          }
          error={submitted && !isValidFirstName(firstName)}
        />
      </FormControl>

      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
      >
        <TextField
          id="outlined-basic-lastName"
          label="Last Name"
          variant="outlined"
          value={lastName}
          onChange={(event) => {
            setLastName(event.target.value);
            setErrorMessage("");
          }}
          helperText={
            submitted && !isValidLastName(lastName)
              ? "Invalid Last Name"
              : ""
          }
          error={submitted && !isValidLastName(lastName)}
        />
      </FormControl>

      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
      >
        <TextField
          id="outlined-basic-email"
          label="Email"
          variant="outlined"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setErrorMessage("");
          }}
          helperText={
            submitted && !isValidEmail(email) ? "Invalid email" : ""
          }
          error={submitted && !isValidEmail(email)}
        />
      </FormControl>

      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
        error={submitted && !isValidPassword(password)}
      >
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
          onChange={(event) => setPassword(event.target.value)}
        />
        <FormHelperText>
          {submitted && !isValidPassword(password) ? (
            <span style={{ color: "#D30A0A" }}>
              Password must be at least 8 characters long and contain
              uppercase, lowercase, number, and special character.
            </span>
          ) : (
            ""
          )}
        </FormHelperText>
      </FormControl>

      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
        error={submitted && !isMatchingPassword(password, cpassword)}
      >
        <InputLabel htmlFor="outlined-adornment-confirm-password">
          Confirm Password
        </InputLabel>
        <OutlinedInput
          id="outlined-adornment-confirm-password"
          type={showConfirmPassword ? "text" : "password"}
          endAdornment={
            <InputAdornment position="end">
              <IconButton
                aria-label="toggle confirm password visibility"
                onClick={handleConfirmPwd}
                onMouseDown={handleConfirmPwdMouseDown}
                edge="end"
              >
                {showConfirmPassword ? (
                  <VisibilityOff />
                ) : (
                  <Visibility />
                )}
              </IconButton>
            </InputAdornment>
          }
          label="Confirm Password"
          value={cpassword}
          onChange={(event) => setCPassword(event.target.value)}
        />
        <FormHelperText>
          {submitted && !isMatchingPassword(password, cpassword) ? (
            <span style={{ color: "#D30A0A" }}>Password mismatch</span>
          ) : (
            ""
          )}
        </FormHelperText>
      </FormControl>

      <FormControl
        className="formControl"
        style={{ marginBottom: "10px" }}
      >
        <label>
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={() => setTermsAccepted(!termsAccepted)}
          />{" "}
          I agree to the{" "}
          <a
            href={termsAndConditionsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            terms and conditions
          </a>
        </label>
        {submitted && !isValidTermsAccepted(termsAccepted) && (
          <FormHelperText style={{ color: "#D30A0A" }}>
            Please accept the terms and conditions
          </FormHelperText>
        )}
      </FormControl>

      {errorMessage && (
        <FormHelperText
          style={{
            color: "#D30A0A",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          {errorMessage}
        </FormHelperText>
      )}

      <Button
        type="submit"
        variant="contained"
        size="large"
        style={{
          height: "45px",
          width: "80%",
          marginTop: "20px",
          backgroundColor: "#1d4ed8",
          color: "white",
        }}
      >
        Submit
      </Button>

      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        open={openAlert}
        autoHideDuration={5000}
        onClose={handleAlertClose}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          Successfully registered!<br />
          Please check your email inbox and verify your account.
        </Alert>
      </Snackbar>
    </form>
  );
}
