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
  Menu,
  MenuItem,
  ListItemIcon,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ClearIcon from "@mui/icons-material/Clear";
import "./Header.css";
import logo from "../../../assets/Logo.png";
import logo1 from "../../../assets/KG_Portal.png";
import { getInitials, getAvatarColorPair } from "../../../utils/avatarUtils";

export default function Header({ user, onOpenAuth, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);

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

  const handleAvatarClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const initials = user
    ? getInitials(user.firstName, user.lastName, user.email)
    : "";
  const avatarColor = user
    ? getAvatarColorPair(user.email || `${user.firstName}${user.lastName}`).light
    : "#000";

  // only allow workspace for logged-in users
  const handleWorkspaceClick = () => {
    if (user) {
      navigate("/workspace");
    } else {
      onOpenAuth && onOpenAuth("/workspace");
    }
  };

  const handleOntologyClick = () => {
    if (user) {
      navigate("/graph");
    } else {
      onOpenAuth && onOpenAuth("/graph");
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
            fullWidth
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
            }}
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
            onClick={() => {
              setDrawerOpen(false);
              handleOntologyClick();
            }}
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

        <ListItem className="list-item" disablePadding>
          <Button
            component={Link}
            to="/instance-generation"
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
          >
            <ListItemText secondary="Instance Generator" />
          </Button>
        </ListItem>

        <ListItem className="list-item" disablePadding>
          <Button
            component={Link}
            to="/validate"
            variant="text"
            className="navbar__link"
            sx={{ justifyContent: "flex-start", width: "100%" }}
          >
            <ListItemText secondary="Validate" />
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
            Profile
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
            sx={{
              textTransform: "none",
              padding: 0,
              minWidth: "auto",
              marginRight: "auto",
              fontSize: "1.1rem",
            }}
          >
            {/* <img src={logo} alt="KG Portal Logo" style={{ width: "120px", height: "auto", objectFit: "contain" }} /> */}
            <img src={logo1} alt="KG Portal Logo" style={{ width: "50px", height: "50px", objectFit: "contain" }} /> Knowledge Graph Portal
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
                to="/canvas"
                variant="text"
                className="header__links_sub"
              >
                Main Canvas
              </Button>

              <Button
                onClick={handleOntologyClick}
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

              <Button
                component={Link}
                to="/instance-generation"
                variant="text"
                className="header__links_sub"
              >
                Instance Generator
              </Button>

              <Button
                component={Link}
                to="/validate"
                variant="text"
                className="header__links_sub"
              >
                Validate
              </Button>
            </div>
          )}

          {/* Right side: SIGNIN or avatar (desktop) */}
          {!isMobile && (
            <div className="header__Rightlinks" style={{ marginLeft: "20px" }}>
              {!user ? (
                <Button
                  variant="contained"
                  onClick={() => onOpenAuth && onOpenAuth()}
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

      {/* Right profile Menu (dropdown) */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: "visible",
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.15))",
            mt: 1.5,
            width: 240,
            "& .MuiAvatar-root": {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            "&:before": {
              content: '""',
              display: "block",
              position: "absolute",
              top: 0,
              right: 20,
              width: 10,
              height: 10,
              bgcolor: "background.paper",
              transform: "translateY(-50%) rotate(45deg)",
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {user && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {user.firstName} {user.lastName}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {user.email}
            </Typography>
          </Box>
        )}
        <Divider sx={{ mb: 1, mt: 0 }} />
        
        <MenuItem
          onClick={() => {
            handleMenuClose();
            navigate("/profile");
          }}
        >
          <ListItemText primary="Profile" />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleMenuClose();
            navigate("/guidance"); 
          }}
        >
          <ListItemText primary="User Guidance" />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleMenuClose();
            navigate("/my-ontologies");
          }}
        >
          <ListItemText primary="My Ontologies" />
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            handleMenuClose();
            onLogout && onLogout();
          }}
        >
          <ListItemText primary="Logout" sx={{ color: "error.main" }} />
        </MenuItem>
      </Menu>
    </>
  );
}