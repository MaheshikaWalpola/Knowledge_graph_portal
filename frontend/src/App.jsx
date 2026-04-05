import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import "./App.css";

import Footer from "./components/Common/Footer/Footer";
import Header from "./components/Common/Header/Header";
import Home from "./components/Nodes/Home";
import SearchConnection from "./components/Nodes/SearchConnection";
import SchemaOntology from "./components/Nodes/SchemaOntology";
import AuthDialog from "./components/model/AuthDialog";
import ForgotPassword from "./components/model/ForgotPassword";
import LoginForm from "./components/model/LoginForm";
import RegistrationForm from "./components/model/RegistrationForm";
import Workspace from "./components/Nodes/Workspace";
import Terms from "./components/Nodes/pages/Terms";
import VerifyEmail from "./components/model/VerifyEmail";
import AIAssistance from "./components/Nodes/AIAssistance";
import Profile from "./components/User/Profile";
import ResetPassword from "./components/User/ResetPassword";
import MyOntologies from "./components/Nodes/MyOntologies";

function App() {
  const [user, setUser] = useState(null); // logged-in user
  const [authOpen, setAuthOpen] = useState(false); // auth modal

  // Load user from localStorage on first render
  useEffect(() => {
    const storedUser = localStorage.getItem("kgp_user");
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
      } catch (e) {
        console.error("Failed to parse stored user", e);
      }
    }
  }, []);

  const handleOpenAuth = () => setAuthOpen(true);
  const handleCloseAuth = () => setAuthOpen(false);

  // called when login/registration succeeds
  const handleAuthSuccess = (userData) => {
    if (!userData) return;

    // store token if backend sends it
    const token = userData.access_token || userData.token;
    if (token) localStorage.setItem("token", token);

    // store user object
    const u = userData.user || userData;
    setUser(u);
    localStorage.setItem("kgp_user", JSON.stringify(u));

    setAuthOpen(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("kgp_user");
    localStorage.removeItem("token");
    setUser(null);
  };

  // called from VerifyEmail after successful verification
  const handleVerifyLoginSuccess = (userData) => {
    if (!userData) return;

    const token = userData.access_token || userData.token;
    if (token) localStorage.setItem("token", token);

    const u = userData.user || userData;
    setUser(u);
    localStorage.setItem("kgp_user", JSON.stringify(u));
  };

  return (
    <div className="app-wrapper">
      <Router>
        <Header
          user={user}
          onOpenAuth={handleOpenAuth}
          onLogout={handleLogout}
        />

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchConnection />} />
            <Route path="/graph" element={<SchemaOntology />} />
            <Route
              path="/login"
              element={<LoginForm onLoginSuccess={handleAuthSuccess} />}
            />
            <Route path="/register" element={<RegistrationForm />} />
            <Route path="/forgotpassword" element={<ForgotPassword />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/my-ontologies" element={<MyOntologies />} />
            <Route path="/termsandconditions" element={<Terms />} />
            <Route
              path="/verify-email"
              element={
                <VerifyEmail onLoginSuccess={handleVerifyLoginSuccess} />
              }
            />
            <Route path="/assistant" element={<AIAssistance />} />
            <Route
              path="/profile"
              element={
                <Profile
                  user={user}
                  onUserUpdated={(updatedUser) => {
                    setUser(updatedUser);
                    localStorage.setItem(
                      "kgp_user",
                      JSON.stringify(updatedUser),
                    );
                  }}
                />
              }
            />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </main>

        <AuthDialog
          open={authOpen}
          onClose={handleCloseAuth}
          onAuthSuccess={handleAuthSuccess}
        />

        <Footer />
      </Router>
    </div>
  );
}

export default App;
