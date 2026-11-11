import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Reads frontend/.env, .env.production etc. Nothing server-specific is hard-coded here.
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");

  // VITE_BASE_PATH: path prefix the app is served under: "/" locally (default),
  // "/knowledgegraphportal/" on the university server. Vite expects a trailing slash.
  const base = (env.VITE_BASE_PATH || "/").replace(/\/*$/, "/");

  // Dev server only (npm run dev): forward API routes to the local backend
  const backend = { target: "http://localhost:8000", changeOrigin: true };
  const server = {
    proxy: {
      "/validation": backend,
      "/workspace": backend,
      "/auth": backend,
      "/users": backend,
    },
  };

  // VITE_PUBLIC_ORIGIN: public address when the dev server runs behind a reverse proxy,
  // e.g. "https://vsr.informatik.tu-chemnitz.de". Leave it unset for local development.
  const publicOrigin = (env.VITE_PUBLIC_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
  if (publicOrigin) {
    const { hostname, protocol, port } = new URL(publicOrigin);
    const secure = protocol === "https:";
    server.origin = publicOrigin;
    server.allowedHosts = [hostname];
    // Hot reload: the browser opens its websocket to the public host, not to localhost:5173
    server.hmr = {
      host: hostname,
      protocol: secure ? "wss" : "ws",
      clientPort: Number(port) || (secure ? 443 : 80),
    };
  }

  return {
    base,
    plugins: [react()],
    server,
  };
});
