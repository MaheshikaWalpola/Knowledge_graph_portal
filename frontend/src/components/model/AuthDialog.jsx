import React, { useState } from "react";
import { styled } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import LoginForm from "./LoginForm";
import RegistrationForm from "./RegistrationForm";

const BootstrapDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialogContent-root": {
    padding: theme.spacing(2),
  },
  "& .MuiDialogPaper-root": {
    borderRadius: 16,
  },
  "& .MuiDialog-paper": {
    minWidth: "600px",
  },
  [theme.breakpoints.down("sm")]: {
    "& .MuiDialog-paper": {
      minWidth: "360px",
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

export default function AuthDialog({ open, onClose, onAuthSuccess }) {
  const [tab, setTab] = useState(0);

  const handleChangeTab = (event, newValue) => {
    setTab(newValue);
  };

  // receive the userData from LoginForm and forward it to App
  const handleLoginSuccess = (userData) => {
    if (typeof onAuthSuccess === "function") {
      onAuthSuccess(userData);
    }
    onClose();
  };

  // adjust this depending on what RegistrationForm returns
  const handleRegisterSuccess = (userData) => {
    if (typeof onAuthSuccess === "function") {
      onAuthSuccess(userData);
    }
    onClose();
  };

  return (
    <BootstrapDialog
      open={open}
      onClose={onClose}
      aria-labelledby="auth-dialog-title"
    >
      <BootstrapDialogTitle id="auth-dialog-title" onClose={onClose}>
        Welcome to Knowledge Graph Portal
      </BootstrapDialogTitle>

      <DialogContent dividers>
        <Box sx={{ width: "100%", bgcolor: "background.paper" }}>
          <Tabs value={tab} onChange={handleChangeTab} centered>
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>

          {tab === 0 ? (
            <LoginForm onLoginSuccess={handleLoginSuccess} />
          ) : (
            <RegistrationForm onRegisterSuccess={handleRegisterSuccess} />
          )}
        </Box>
      </DialogContent>
    </BootstrapDialog>
  );
}
