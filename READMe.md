# Knowledge Graph Portal

A research prototype for visualising and querying an OWL ontology for
Chemical Mechanical Planarization (CMP) processes in semiconductor manufacturing.
The ontology (CMPO) is aligned with the Basic Formal Ontology (BFO) and
populated with real process data.

The portal provides a graph-based interface for exploring instances,
running SPARQL queries, and generating natural language explanations
with the help of a large language model.

## Prerequisites

Before running the project, make sure you have:

- Python 3.10+
- Node.js 20+ and npm
- GraphDB (free edition) - https://graphdb.ontotext.com/
- Git

## 1. GraphDB Setup

1. Install GraphDB and open the workbench at `http://localhost:7200`
2. Go to **Setup -> Repositories -> Create new repository**
3. Set the repository name to `cmp_repo` and click **Create**
4. Go to **Import -> Upload RDF file**
5. Upload `ontology/VSR_CMP_schema.ttl` and `data/instances_v2.ttl`
6. Make sure the target repository is `cmp_repo` and click **Import**

## 2. Backend Setup (FastAPI)

```
cd backend

python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS/Linux)
source .venv/bin/activate

pip install -r requirement.txt
```

Copy `backend/.env.example` to `backend/.env` and fill in the values
(shared separately). Every variable is described in the example file.

Start the server:

```
uvicorn main:app --reload --port 8000
```

## 3. Frontend Setup (React / Vite)

Create `frontend/.env` with:

```
VITE_API_URL=http://localhost:8000
VITE_CMP_NS=https://tucid/cmpo/
```

Then:

```
cd frontend
npm install
npm run dev
```

The portal will be available at `http://localhost:5173`.

## 4. Production Deployment

On the server the portal runs under a path prefix:

| Part | Public URL |
|---|---|
| Frontend (static files) | `https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/` |
| Backend API (FastAPI) | `https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api/` |

The API needs its own prefix because its routes (`/auth`, `/workspace`, `/validation`,
`/assistant`, ...) are served at the root and several share names with frontend pages.
All server-specific settings live in `.env` files, which git ignores, so a `git pull`
never overwrites them.

### Frontend

Create `frontend/.env.production` once (values are compiled in at build time):

```
VITE_API_URL=https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api
VITE_BASE_PATH=/knowledgegraphportal/
VITE_CMP_NS=https://tucid/cmpo/
```

Build, and rebuild after every `git pull`:

```
cd frontend
npm ci
npm run build
```

nginx serves `frontend/dist/` as static files. Do not use `npm run dev` on the server:
it is a development server (it opens a hot-reload websocket to `localhost:5173`).

### Backend

Set these in `backend/.env` in addition to the usual values (see `backend/.env.example`):

```
FRONTEND_BASE_URL=https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal
CORS_ORIGINS=https://vsr.informatik.tu-chemnitz.de
API_ROOT_PATH=/knowledgegraphportal/api
```

- `FRONTEND_BASE_URL` is used for the links in verification and password-reset e-mails.
- `CORS_ORIGINS`: if it is empty, every origin is allowed and a warning is logged at startup.
- `API_ROOT_PATH` lets FastAPI accept the prefixed paths and generate correct URLs for
  `/docs` and redirects.

Run (without `--reload`):

```
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips='*'
```

`--proxy-headers` makes FastAPI use the scheme (`https`) forwarded by nginx.
API docs: `https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api/docs`.

### nginx

```nginx
# Backend API. No trailing slash after the port: nginx forwards the full path
# (with /knowledgegraphportal/api); the backend removes the prefix via API_ROOT_PATH.
location /knowledgegraphportal/api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;                 # otherwise redirects point to the internal hostname
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;                         # live progress streams (server-sent events)
    proxy_read_timeout 3600s;                    # SHACL generation/verification can take many minutes
    client_max_body_size 100m;                   # ontology and instance uploads (35 MB and more)
}

# Frontend (React app). Unknown paths fall back to index.html so React routes
# such as /knowledgegraphportal/validate survive a page reload.
location /knowledgegraphportal/ {
    alias /path/to/Knowledge_graph_portal/frontend/dist/;
    try_files $uri $uri/ /knowledgegraphportal/index.html;
}
```

### Update procedure

```
git pull
cd frontend && npm ci && npm run build
# restart the backend process (uvicorn)
```

### Checks after deployment

- Every page URL keeps the `/knowledgegraphportal/` prefix, and F5 on any page does not give a 404.
- The browser console shows no requests to `localhost:8000` and no websocket to `localhost:5173`.
- The link in a verification e-mail starts with `https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/`.
- `https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api/docs` opens.

## Next Steps

The current version is a single-ontology research prototype.
Planned future work includes extending the portal into a multi-ontology
editor.