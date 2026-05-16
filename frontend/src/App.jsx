import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import axios from "axios";
import "./App.css";

import Footer from "./components/Common/Footer/Footer";
import Header from "./components/Common/Header/Header";
import Home from "./components/Nodes/Home";
import CanvasEditor from "./components/Canvas/CanvasEditor";
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
import UserGuidance from "./components/Nodes/UserGuidance";

function App() {
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [redirectAfterAuth, setRedirectAfterAuth] = useState(null);

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

  const handleOpenAuth = (redirectUrl = null) => {
    setRedirectAfterAuth(redirectUrl);
    setAuthOpen(true);
  };
  const handleCloseAuth = () => setAuthOpen(false);

  const handleAuthSuccess = (userData) => {
    if (!userData) return;
    const token = userData.access_token || userData.token;
    if (token) localStorage.setItem("token", token);
    const u = userData.user || userData;
    setUser(u);
    localStorage.setItem("kgp_user", JSON.stringify(u));
    setAuthOpen(false);

    if (redirectAfterAuth) {
      window.location.href = redirectAfterAuth;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("kgp_user");
    localStorage.removeItem("token");
    setUser(null);
    window.location.href = "/";
  };

  // Global axios interceptor for 401 Unauthorized
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Token expired or invalid
          console.log("401 Unauthorized, logging out");
          handleLogout();
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  // Auto-logout due to inactivity (1 hour)
  useEffect(() => {
    let timeoutId;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      // 1 hour = 60 * 60 * 1000 ms
      timeoutId = setTimeout(() => {
        if (user) {
          console.log("Logging out due to inactivity");
          handleLogout();
        }
      }, 60 * 60 * 1000);
    };

    if (user) {
      resetTimer();
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
      events.forEach(event => document.addEventListener(event, resetTimer));

      return () => {
        clearTimeout(timeoutId);
        events.forEach(event => document.removeEventListener(event, resetTimer));
      };
    }
  }, [user]);

  const handleVerifyLoginSuccess = (userData) => {
    if (!userData) return;
    const token = userData.access_token || userData.token;
    if (token) localStorage.setItem("token", token);
    const u = userData.user || userData;
    setUser(u);
    localStorage.setItem("kgp_user", JSON.stringify(u));
  };

  const handleLoginRouteSuccess = (userData) => {
    handleAuthSuccess(userData);
    window.location.href = "/";
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
            <Route path="/graph" element={<SchemaOntology onOpenAuth={handleOpenAuth} />} />
            <Route
              path="/login"
              element={<LoginForm onLoginSuccess={handleLoginRouteSuccess} />}
            />
            <Route path="/register" element={<RegistrationForm />} />
            <Route path="/forgotpassword" element={<ForgotPassword />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/my-ontologies" element={<MyOntologies onOpenAuth={handleOpenAuth} />} />
            <Route path="/canvas" element={<CanvasEditor onOpenAuth={handleOpenAuth} />} />
            <Route path="/termsandconditions" element={<Terms />} />
            <Route
              path="/verify-email"
              element={
                <VerifyEmail onLoginSuccess={handleVerifyLoginSuccess} />
              }
            />
            <Route path="/assistant" element={<AIAssistance onOpenAuth={handleOpenAuth} />} />
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
            <Route path="/guidance" element={<UserGuidance />} />
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
