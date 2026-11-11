import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Link } from "react-router-dom";
import "./Footer.css";

function Copyright() {
  const year = new Date().getFullYear();

  return (
    <Typography variant="body2" color="text.secondary">
      © VSR - Technical University of Chemnitz {year}
    </Typography>
  );
}

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        py: 3,
        px: 2,
        mt: "auto",
      }}
    >
      <Typography variant="body1" sx={{ mb: 0.5 }}>
        Knowledge Graph Portal
      </Typography>

      <Box sx={{ display: "flex", gap: 2, my: 1, flexWrap: "wrap", justifyContent: "center" }}>
        <Link to="/guidance" className="footer-link">
          User Guidance
        </Link>
        <span className="footer-link-divider">•</span>
        <Link to="/termsandconditions" className="footer-link">
          Terms & Conditions
        </Link>
      </Box>

      <Copyright />
    </Box>
  );
}
