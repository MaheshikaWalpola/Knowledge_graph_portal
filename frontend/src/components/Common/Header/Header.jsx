import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Button,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemText,
  useMediaQuery,
  Box,
  Avatar,
  Typography,
  Divider,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ClearIcon from "@mui/icons-material/Clear";
import "./Header.css";

// helper for initials
const getInitials = (firstName, lastName, email) => {
  const f = firstName?.trim()?.[0] || "";
  const l = lastName?.trim()?.[0] || "";
  if (f || l) return (f + l).toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
};

// helper for avatar color (based on email or name)
const getAvatarColor = (seed) => {
  const colors = [
    "#3498db",
    "#9b59b6",
    "#e67e22",
    "#e74c3c",
    "#2ecc71",
    "#f1c40f",
    "#16a085",
  ];
  if (!seed) return colors[0];
  let sum = 0;
  for (let i = 0; i < seed.length; i++) {
    sum += seed.charCodeAt(i);
  }
  return colors[sum % colors.length];
};

export default function Header({ user, onOpenAuth, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);

  const isMobile = useMediaQuery("(max-width:910px)");
  const navigate = useNavigate();

  const toggleDrawer = (open) => (event) => {
    if (
      event?.type === "keydown" &&
      (event.key === "Tab" || event.key === "Shift")
    )
      return;
    setDrawerOpen(open);
  };

  const handleAvatarClick = () => {
    setProfileDrawerOpen(true);
  };

  const handleProfileDrawerClose = () => {
    setProfileDrawerOpen(false);
  };

  const initials = user
    ? getInitials(user.firstName, user.lastName, user.email)
    : "";
  const avatarColor = user
    ? getAvatarColor(user.email || `${user.firstName}${user.lastName}`)
    : "#000";

  // only allow workspace for logged-in users
  const handleWorkspaceClick = () => {
    if (user) {
      navigate("/workspace");
    } else {
      onOpenAuth && onOpenAuth();
    }
  };

  // Drawer content (left nav)
  const list = () => (
    <Box
      role="presentation"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        pb: 2,
      }}
      onKeyDown={toggleDrawer(false)}
    >
      {/* Top: nav items */}
      <List onClick={toggleDrawer(false)}>
        <ListItem className="list-item" disablePadding>
          <Button
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
            onClick={() => {
              setDrawerOpen(false);
              handleWorkspaceClick();
            }}
          >
            <ListItemText secondary="Workspace" />
          </Button>
        </ListItem>

        <ListItem className="list-item" disablePadding>
          <Button
            component={Link}
            to="/graph"
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
          >
            <ListItemText secondary="Ontology" />
          </Button>
        </ListItem>

        <ListItem className="list-item" disablePadding>
          <Button
            component={Link}
            to="/assistant"
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
          >
            <ListItemText secondary="AI Assistant" />
          </Button>
        </ListItem>

        <ListItem className="list-item" disablePadding>
          <Button
            component={Link}
            to="/"
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
          >
            <ListItemText secondary="Main Canvas" />
          </Button>
        </ListItem>
      </List>

      {/* Bottom: auth area inside drawer (for mobile) */}
      <Box sx={{ mt: "auto", px: 2, pb: 2 }}>
        {!user ? (
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              setDrawerOpen(false);
              onOpenAuth && onOpenAuth();
            }}
            sx={{
              backgroundColor: "black",
              color: "white",
              borderRadius: "30px",
              textTransform: "none",
              paddingY: 1,
              "&:hover": { backgroundColor: "#333" },
            }}
          >
            SIGNIN
          </Button>
        ) : (
          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              setDrawerOpen(false);
              setProfileDrawerOpen(true);
            }}
            sx={{
              borderRadius: "30px",
              textTransform: "none",
              paddingY: 1,
            }}
          >
            Account
          </Button>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <AppBar
        position="static"
        sx={{ backgroundColor: "#F9F9F9", boxShadow: "none" }}
        className="navbar"
      >
        <Toolbar>
          {isMobile && (
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={toggleDrawer(true)}
              className="menu-icon"
              sx={{ ml: "-10px" }}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Button
            component={Link}
            to="/"
            className="navbar__link"
            sx={{ textTransform: "none" }}
          >
            <p className="title" style={{ margin: 0 }}>
              Knowledge Graph Portal
            </p>
          </Button>

          {/* Center/right nav links for desktop */}
          {!isMobile && (
            <div
              className="header__links"
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              <Button
                component={Link}
                to="/"
                variant="text"
                className="header__links_sub"
              >
                Main Canvas
              </Button>

              <Button
                component={Link}
                to="/graph"
                variant="text"
                className="header__links_sub"
              >
                Ontology
              </Button>

              <Button
                component={Link}
                to="/assistant"
                variant="text"
                className="header__links_sub"
              >
                AI Assistant
              </Button>

              <Button
                variant="text"
                className="header__links_sub"
                onClick={handleWorkspaceClick}
              >
                Workspace
              </Button>
            </div>
          )}

          {/* Right side: SIGNIN or avatar (desktop) */}
          {!isMobile && (
            <div className="header__Rightlinks" style={{ marginLeft: "20px" }}>
              {!user ? (
                <Button
                  variant="contained"
                  onClick={onOpenAuth}
                  sx={{
                    backgroundColor: "black",
                    color: "white",
                    borderRadius: "30px",
                    textTransform: "none",
                    paddingX: 2,
                    "&:hover": { backgroundColor: "#333" },
                  }}
                >
                  SIGNIN
                </Button>
              ) : (
                <IconButton onClick={handleAvatarClick}>
                  <Avatar
                    sx={{
                      width: 40,
                      height: 40,
                      bgcolor: avatarColor,
                      fontSize: 18,
                    }}
                  >
                    {initials}
                  </Avatar>
                </IconButton>
              )}
            </div>
          )}
        </Toolbar>
      </AppBar>

      {/* Left nav drawer (mobile) */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={toggleDrawer(false)}
        PaperProps={{ sx: { width: 220 } }}
      >
        <div>
          <IconButton
            color="inherit"
            edge="end"
            onClick={toggleDrawer(false)}
            aria-label="close drawer"
            sx={{ ml: "auto", display: "block", mt: 1, mr: 1 }}
          >
            <ClearIcon />
          </IconButton>
        </div>

        {list()}
      </Drawer>

      {/* Right profile drawer (avatar click) */}
      <Drawer
        anchor="right"
        open={profileDrawerOpen}
        onClose={handleProfileDrawerClose}
        PaperProps={{ sx: { width: 260 } }}
      >
        <Box
          sx={{
            p: 2,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          {user && (
            <>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  mb: 2,
                  mt: 1,
                }}
              >
                <Avatar
                  sx={{
                    width: 48,
                    height: 48,
                    bgcolor: avatarColor,
                    fontSize: 20,
                  }}
                >
                  {initials}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1">
                    {user.firstName} {user.lastName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {user.email}
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ mb: 1 }} />

              <List>
                <ListItem
                  button
                  onClick={() => {
                    handleProfileDrawerClose();
                    navigate("/profile");
                  }}
                >
                  <ListItemText primary="Profile" />
                </ListItem>
                <ListItem
                  button
                  onClick={() => {
                    handleProfileDrawerClose();
                    onLogout && onLogout();
                  }}
                >
                  <ListItemText primary="Logout" />
                </ListItem>
              </List>
            </>
          )}
        </Box>
      </Drawer>
    </>
  );
}