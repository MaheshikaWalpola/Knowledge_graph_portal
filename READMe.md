# Knowledge Graph Portal

Knowledge Graph Portal is a web application designed for exploring, querying, generating, validating, and visualizing domain-specific knowledge graphs. The platform is centered around Chemical Mechanical Planarization (CMP) processes in semiconductor manufacturing, adhering to the Chemical Mechanical Planarization Ontology (CMPO) aligned with the W3C SOSA/SSN (Sensor, Observation, Sample, and Actuator) ontology.

The portal provides an interactive graph interface, custom canvas workspace, natural language query assistance powered by LLMs, automated instance generation workflows, and SHACL-based graph validation.

---

## Key Features

- **Interactive Graph & Schema Visualization**: Explore ontology classes, instances, and graph relationships dynamically using Cytoscape and ReactFlow.
- **Ontology Workspace & Canvas Editor**: Visual canvas tool to design, edit, import, and export RDF/OWL graph structures.
- **Schema Change History & Version Tracking**: Automatic versioning, granular node/edge diff tracking, and audit logging of ontology modifications.
- **AI-Powered Query & Chat Assistance**: Convert natural language queries into SPARQL queries and obtain natural language explanations of graph relations using OpenAI or KISTE LLM backends.
- **Instance Generation Workflow**: Guided multi-step process for generating and populating ontology instances from structured process data.
- **SHACL Graph Validation**: Validate RDF graph data against defined SHACL shapes (`pyshacl`) to enforce schema integrity.
- **User Management & Authentication**: Secure JWT-based user authentication, role management, and user profile persistence using MongoDB.

---

## User Guidance: Schema Change History & Version Tracking

The **Schema Change History** feature provides automated version control and audit logging for every ontology schema edited within the portal.

```
┌────────────────────────┐       Granular Diff        ┌─────────────────────────┐
│     Canvas Editor      │  ────────────────────────> │     MongoDB History     │
│  (Design / Save Nodes) │     (POST /history/log)    │  (v1, v2... Diffs, TS)  │
└────────────────────────┘                            └────────────┬────────────┘
                                                                   │
                                                                   ▼
                                                      ┌─────────────────────────┐
                                                      │  User Profile (History) │
                                                      │   - Filter by Schema    │
                                                      │   - Expand Node/Edge Diff
                                                      │   - Prune / Delete Logs │
                                                      └─────────────────────────┘
```

### 1. How Changes Are Tracked
- **Automatic Snapshot Comparison**: Every time you save or update an ontology in the **Canvas Editor** (via *Save to Workspace* or *Update in Workspace*), the system computes a detailed diff between the previous saved snapshot and your current canvas.
- **Tracked Elements**:
  - **Nodes / Classes**: Additions, removals, and modifications to node labels, IRIs, types, and descriptions.
  - **Edges / Relations**: Additions, removals, and modifications to edge predicates and relation types.
- **Automatic Versioning**: Each save automatically assigns an incremented version number (`v1`, `v2`, `v3`, ...) for that schema under your user account.

### 2. Viewing History in the User Profile
1. Click on your profile avatar or navigate to the **User Profile** page (`/profile`).
2. Scroll to the **Schema Change History** section at the bottom of the profile page.
3. Use the **Schema Filter Dropdown** to view logs for all schemas or narrow down to a specific ontology.
4. Click the **Refresh Button** (↺) to reload the latest change records at any time.

### 3. Inspecting Granular Diffs
- Each history row displays:
  - **Version Badge** (e.g., `v1`, `v2`)
  - **Schema Name**
  - **High-Level Summary** (e.g., `Added 2 node(s), Removed 1 edge(s)`)
  - **Timestamp** (relative or localized date/time)
- **Click on any history row** to expand the detailed diff panel:
  - **Nodes Added / Removed**: Displays node labels and types.
  - **Nodes Modified**: Highlights before and after values for changed fields.
  - **Edges Added / Removed / Modified**: Displays source, target, and relationship predicates.

### 4. Managing History Logs
- **Pagination**: The history list loads 10 entries at a time. Click **Load More Logs** to retrieve older records.
- **Deleting History Entries**: Click the **Delete icon** (trash can) on any row. An inline confirmation prompt will appear—click **Delete** to permanently remove the log entry, or **Cancel** to abort.

### 5. Schema History API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/history/log` | Record a new schema change event and generate the next version |
| `GET` | `/history/user/all` | Get paginated history logs for the current user (with optional `schema_id` filter) |
| `GET` | `/history/user/schemas` | Get list of distinct schemas that have recorded history |
| `GET` | `/history/{schema_id}` | Retrieve all revision logs for a specific schema ID |
| `GET` | `/history/entry/{entry_id}` | Get full details of a specific history log entry |
| `DELETE` | `/history/entry/{entry_id}` | Delete a single history log entry |

---

## Technology Stack

### Frontend
- **Framework**: React 19, Vite
- **Routing**: React Router v7
- **UI Components**: Material UI (MUI), Emotion
- **Graph Visualization**: Cytoscape.js, ReactFlow, Dagre
- **HTTP Client**: Axios
- **Data Visualization**: Recharts

### Backend
- **Framework**: FastAPI (Python 3.10+)
- **Server**: Uvicorn
- **Semantic Web & Graph Tools**: RDFLib, SPARQLWrapper, PySHACL
- **Data & Documents**: Pandas, ReportLab
- **Database Drivers**: PyMongo

### Databases & External Services
- **Graph Store**: Ontotext GraphDB (SPARQL endpoint)
- **Document Store**: MongoDB
- **AI Services**: OpenAI API / KISTE LLM API
- **Authentication**: JWT (JSON Web Tokens)
- **Email Service**: SMTP (Gmail / Custom SMTP)

---

## Prerequisites

Ensure you have the following installed on your system before proceeding:

1. **Git**: Version control client.
2. **Python**: Version 3.10 or higher.
3. **Node.js**: Version 20 or higher, with `npm` (v10+).
4. **GraphDB**: Ontotext GraphDB (Free Edition) installed and running. Download from [Ontotext GraphDB](https://graphdb.ontotext.com/).
5. **MongoDB**: A local MongoDB instance or a remote MongoDB Atlas cluster connection string.

---

## Local Setup Guide

Follow these steps to set up and run the application locally.

### Step 1: Clone the Repository

```bash
git clone https://github.com/MaheshikaWalpola/Knowledge_graph_portal.git
cd Knowledge_graph_portal
```

---

### Step 2: GraphDB Setup

1. Start your local **GraphDB** server (typically accessible at `http://localhost:7200`).
2. Open the GraphDB Workbench in your browser: `http://localhost:7200`.
3. Navigate to **Setup** > **Repositories** > **Create new repository** > **GraphDB repository**.
4. Set the **Repository ID** (e.g., `CMP` or matching your backend `.env` configuration) and click **Create**.

*Note: Ontology schemas and instance dataset files (.ttl, .owl, .rdf) can be uploaded directly within the Knowledge Graph Portal interface through the **Workspace** page.*

---

### Step 3: Backend Setup (FastAPI)

1. Open a terminal and navigate to the `backend` directory:

   ```bash
   cd backend
   ```

2. Create a Python virtual environment:

   - **Windows**:
     ```cmd
     python -m venv .venv
     .venv\Scripts\activate
     ```

   - **macOS / Linux**:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. Install the required Python packages:

   ```bash
   pip install -r requirement.txt
   ```

4. Create a `.env` file in the `backend` directory:

   ```env
   # GraphDB Configuration
   GRAPHDB_BASE_URL=http://localhost:7200
   GRAPHDB_REPOSITORY=CMP
   CMP_NS=https://tucid/cmpo/
   CMP_INSTANCE_NS=https://tucid/cmpo/instance/
   BASE_SCHEMA_GRAPH=https://tucid/cmpo/base
   BASE_INSTANCE_GRAPH=https://tucid/cmpo/graph/base-instances

   # CORS Configuration
   CORS_ORIGINS=http://localhost:5173

   # MongoDB Configuration
   MONGODB_URI=<your_mongo_db_url_here>
   MONGODB_DB=<your_database_name_here>

   # JWT Security
   JWT_SECRET=your_jwt_secret_key_here
   JWT_ALGORITHM=HS256

   # Frontend Application URL
   FRONTEND_BASE_URL=http://localhost:5173

   # Optional Email Notification Setup (SMTP)
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_password
   MAIL_FROM=your_email@gmail.com
   MAIL_PORT=587
   MAIL_SERVER=smtp.gmail.com

   # AI models: Kiste (TU Chemnitz server) is always used; the cloud providers are optional and
   # appear in the model selector of the validation page only when their key is set
   KISTE_API_URL=https://kiste.informatik.tu-chemnitz.de/v1/chat/completions
   KISTE_API_KEY=your_kiste_key
   KISTE_MODEL=Qwen3.6-35B-A3B-MLX-8bit
   ANTHROPIC_API_KEY=your_anthropic_api_key   # optional: adds Claude models (pip install anthropic)
   OPENAI_API_KEY=your_openai_api_key         # optional: adds OpenAI models (pip install openai)
   ```

5. Start the FastAPI development server:

   ```bash
   uvicorn main:app --reload --port 8000
   ```

   The backend service will run at `http://localhost:8000`.

---

### Step 4: Frontend Setup (React + Vite)

1. Open a new terminal and navigate to the `frontend` directory:

   ```bash
   cd frontend
   ```

2. Install Node.js dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the `frontend` directory:

   ```env
   VITE_API_URL=http://localhost:8000
   VITE_CMP_NS=https://tucid/cmpo/
   ```

4. Start the frontend development server:

   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:5173`.

---


## Project Structure

```
Knowledge_graph_portal/
├── backend/
│   ├── controllers/      # Business logic handlers
│   ├── core/             # Application config, auth & settings
│   ├── ontology/         # Default SHACL shapes & schema definitions
│   ├── routers/          # FastAPI route endpoints (auth, graph, chat, history, validation)
│   ├── services/         # SPARQL wrapper, MongoDB, history, & LLM service integration
│   ├── main.py           # Application entrypoint & CORS middleware
│   └── requirement.txt   # Python dependencies
├── frontend/
│   ├── public/           # Static assets
│   ├── src/
│   │   ├── components/   # UI components (Canvas, Nodes, User, Models)
│   │   ├── utils/        # Axios helpers & API handlers
│   │   ├── App.jsx       # Route definitions & global layout
│   │   └── main.jsx      # React entrypoint
│   ├── package.json      # Frontend dependencies & scripts
│   └── vite.config.js    # Vite configuration
└── READMe.md             # Project documentation
```

---

## Production Deployment

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

nginx serves `frontend/dist/` as static files. This is the recommended setup.

**Alternative: dev server behind the reverse proxy.** If the server runs `npm run dev`
instead of serving the build, Vite reads `frontend/.env` (not `.env.production`). Put the
same values there and add the public address of the server:

```
VITE_API_URL=https://vsr.informatik.tu-chemnitz.de/knowledgegraphportal/api
VITE_BASE_PATH=/knowledgegraphportal/
VITE_PUBLIC_ORIGIN=https://vsr.informatik.tu-chemnitz.de
VITE_CMP_NS=https://tucid/cmpo/
```

`vite.config.js` derives the dev server's `origin`, `allowedHosts` and the hot-reload
websocket (`wss` on port 443 for an `https` address) from `VITE_PUBLIC_ORIGIN`, so no
domain is hard-coded. Leave the variable unset for local development.

### Backend

Set these in `backend/.env` in addition to the values from the Local Setup Guide:

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


