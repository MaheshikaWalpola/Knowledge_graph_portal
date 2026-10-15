import React, { useState } from "react";
import Axios from "axios";
import PropTypes from "prop-types";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import TextField from "@mui/material/TextField";
import { styled } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Typography from "@mui/material/Typography";
import FormHelperText from "@mui/material/FormHelperText";
import "./Form.css";
import { API } from "../../config";


const BootstrapDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialogContent-root": {
    padding: theme.spacing(2),
  },
  "& .MuiDialogActions-root": {
    padding: theme.spacing(1),
  },
  "& .MuiDialog-paper": {
    minWidth: "600px",
  },
  [theme.breakpoints.down("sm")]: {
    "& .MuiDialog-paper": {
      minWidth: "380px",
      margin: 8,
    },
  },
}));

function BootstrapDialogTitle(props) {
  const { children, onClose, ...other } = props;

  return (
    <DialogTitle
      sx={{ m: 0, p: 2, fontWeight: "bold", textAlign: "center" }}
      {...other}
    >
      {children}
      {onClose ? (
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      ) : null}
    </DialogTitle>
  );
}

BootstrapDialogTitle.propTypes = {
  children: PropTypes.node,
  onClose: PropTypes.func.isRequired,
};

export default function ForgotPassword({
  openForgotPassword,
  handleCloseForgotPassword,
  onSendSuccess,
}) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleSendPasswordResetLink = () => {
    setSubmitted(true);
    setLoginError("");

    if (!isValidEmail(email)) {
      return;
    }

    Axios.post(`${API}/user/forgotpassword`, { email })
      .then((response) => {
        if (response) {
          setEmail("");
          setLoginError("");

          if (typeof onSendSuccess === "function") {
            onSendSuccess();
          }
        } else {
          console.error("Invalid response:", response);
          setLoginError(
            "Error occurred while sending the password reset link. Please try again."
          );
        }
      })
      .catch((error) => {
        console.error("Forgot password error:", error?.response?.data || error);
        setLoginError("User does not exist");
      });
  };

  const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);

  return (
    <BootstrapDialog
      onClose={handleCloseForgotPassword}
      aria-labelledby="forgot-password-dialog-title"
      open={openForgotPassword}
    >
      <BootstrapDialogTitle
        id="forgot-password-dialog-title"
        onClose={handleCloseForgotPassword}
      >
        Forgot Password?
      </BootstrapDialogTitle>

      <DialogContent>
        <Typography gutterBottom style={{ textAlign: "center", marginBottom: "10px" }}>
          Enter your email and we'll send you a link to set your password.
        </Typography>

        <div className="login__form">
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
                setLoginError("");
              }}
              helperText={
                submitted && !isValidEmail(email) ? "Invalid email" : ""
              }
              error={submitted && !isValidEmail(email)}
            />
          </FormControl>

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

          <Button
            variant="contained"
            size="large"
            style={{
              height: "40px",
              width: "80%",
              marginTop: "20px",
              backgroundColor: "#1d4ed8",
              color: "white",
            }}
            onClick={handleSendPasswordResetLink}
          >
            Send
          </Button>
        </div>
      </DialogContent>
    </BootstrapDialog>
  );
}
