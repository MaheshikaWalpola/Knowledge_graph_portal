# Knowledge Graph Portal

Knowledge Graph Portal is a web application designed for exploring, querying, generating, validating, and visualizing domain-specific knowledge graphs. The platform is centered around Chemical Mechanical Planarization (CMP) processes in semiconductor manufacturing, adhering to the Chemical Mechanical Planarization Ontology (CMPO) aligned with the W3C SOSA/SSN (Sensor, Observation, Sample, and Actuator) ontology.

The portal provides an interactive graph interface, custom canvas workspace, natural language query assistance powered by LLMs, automated instance generation workflows, and SHACL-based graph validation.

---

## Key Features

- **Interactive Graph & Schema Visualization**: Explore ontology classes, instances, and graph relationships dynamically using Cytoscape and ReactFlow.
- **Ontology Workspace & Canvas Editor**: Visual canvas tool to design, edit, import, and export RDF/OWL graph structures.
- **AI-Powered Query & Chat Assistance**: Convert natural language queries into SPARQL queries and obtain natural language explanations of graph relations using OpenAI or KISTE LLM backends.
- **Instance Generation Workflow**: Guided multi-step process for generating and populating ontology instances from structured process data.
- **SHACL Graph Validation**: Validate RDF graph data against defined SHACL shapes (`pyshacl`) to enforce schema integrity.
- **User Management & Authentication**: Secure JWT-based user authentication, role management, and user profile persistence using MongoDB.

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

   # AI Assistance (OpenAI or KISTE API)
   OPENAI_API_KEY=your_openai_api_key
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
│   ├── core/             # Application config and settings
│   ├── ontology/         # Default SHACL shapes & schema definitions
│   ├── routers/          # FastAPI route endpoints (auth, graph, chat, validation)
│   ├── services/         # SPARQL wrapper, DB, & LLM service integration
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
