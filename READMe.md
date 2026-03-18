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

pip install -r requirements.txt
```

Create a `.env` file inside `backend/` with the following variables
(values shared separately):

```
GRAPHDB_URL=http://localhost:7200
GRAPHDB_REPO=cmp_repo
OPENAI_API_KEY=your_key_here
```

Start the server:

```
uvicorn main:app --reload --port 8000
```

## 3. Frontend Setup (React / Vite)

```
cd frontend
npm install
npm run dev
```

The portal will be available at `http://localhost:5173`.

## Next Steps

The current version is a single-ontology research prototype.
Planned future work includes extending the portal into a multi-ontology
editor
