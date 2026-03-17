# Knowledge Graph Portal

A research prototype for visualising and querying an OWL ontology for
Chemical Mechanical Planarization (CMP) processes in semiconductor manufacturing.
The ontology (CMPO) is aligned with the Basic Formal Ontology (BFO) and
populated with real process data.

The portal provides a graph-based interface for exploring instances,
running SPARQL queries, and generating natural language explanations
with the help of a large language model.

## Research Background

Knowledge graphs have emerged as a powerful approach for representing and
querying complex domain knowledge in manufacturing and industrial settings.
In the domain of Chemical Mechanical Planarization (CMP), process knowledge
is distributed across equipment logs, recipes, metrology reports, and expert
know-how, making it difficult to query and reason over in a unified way.

This prototype investigates how an OWL ontology (CMPO), aligned with the
Basic Formal Ontology (BFO), can serve as a common semantic layer for CMP
process data. The ontology captures the key classes, properties, and
relationships of the CMP domain including equipment, consumables, process
parameters, wafer properties, and agent roles.

The knowledge graph was built through three stages. Domain concepts were
first elicited and structured with the help of a large language model, then
reviewed and corrected by a domain expert. Industrial sensor and process data
from CSV logs was then mapped to CMPO classes and serialised as RDF triples,
loaded into GraphDB. A natural language explanation feature is currently in
progress, aiming to translate SPARQL query results into plain language
summaries for process engineers using an LLM.

The portal provides a web interface for exploring the graph, searching schema
relationships, editing triples, and uploading CSV data to generate instances.

## Repository Structure

```
KGPortal/
    backend/                    python
    frontend/                   React/Vite
    ontology/
        VSR_CMP_schema.ttl      CMPO schema (TBox), BFO-aligned
        Schema_instance_based.ttl
    data/
        instances_v2.ttl        RDF instance data (ABox)
        CMP-training-000.csv    raw PHM sensor data
        CMP-training-removalrate.csv    removal rate labels
    SHACL/
        cmpo_shapes.ttl         SHACL validation constraint shapes
    Prompts/
        ontology_elicitation.md     Stage 1 LLM prompts
        explanation_generation.md   Stage 3 LLM prompts
    Screenshots/
        README.md               description of each screenshot
        *.png                   portal screenshots
    READMe.md                   this file
```

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
editor.
