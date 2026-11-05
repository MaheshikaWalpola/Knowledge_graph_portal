// Central runtime configuration. Vite inlines these values at build time from
// frontend/.env (npm run dev) or frontend/.env.production (npm run build).

const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  // Fail loudly instead of silently calling a wrong host (e.g. localhost:8000 from a user's browser)
  throw new Error(
    "VITE_API_URL is not set. Add it to frontend/.env (development) or frontend/.env.production (build) and rebuild."
  );
}

// Backend API base URL without a trailing slash, e.g. https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api
export const API = apiUrl.replace(/\/+$/, "");

// Path prefix the app is served under: "/" locally, "/knowledgegraphportal/" on the server (VITE_BASE_PATH).
// Vite exposes the configured `base` as import.meta.env.BASE_URL.
export const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, "");

// Full browser path for an app route, for redirects that bypass React Router (window.location).
export const appUrl = (route = "/") => `${ROUTER_BASENAME}${route.startsWith("/") ? route : `/${route}`}`;
