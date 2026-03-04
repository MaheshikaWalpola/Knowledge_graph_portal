import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
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

      <Copyright />
    </Box>
  );
}
