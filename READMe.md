# KG Portal - CMP Process Knowledge Graph

A research prototype for visualising and querying an OWL ontology for
Chemical Mechanical Planarization (CMP) processes in semiconductor manufacturing.
The ontology (CMPO) is aligned with the Basic Formal Ontology (BFO) and
populated with real process data.

The portal provides a graph-based interface for exploring instances,
running SPARQL queries, and generating natural language explanations
with the help of a large language model.

---

## Method

The ontology and instance data were created through a three-stage pipeline:

**Stage 1 - Ontology Elicitation (LLM-assisted)**
An LLM (GPT-4) was prompted iteratively to draft classes, properties, and
BFO alignments for the CMP domain. The generated drafts were reviewed and
corrected by a domain expert. See `prompts/ontology_elicitation.md`.

**Stage 2 - Knowledge Graph Population**
Process data from industrial CSV logs was mapped to CMPO classes and
serialised as RDF triples in Turtle format. The result is stored in
`data/instances_v2.ttl` and loaded into a local GraphDB repository.

**Stage 3 - Explanation Generation (LLM-assisted)**
SPARQL query results returned from the graph are passed to an LLM to
generate plain-language explanations for process engineers. The prompts
used for this step are in `prompts/explanation_generation.md`.

---

## Repository Structure

```
KGPortal/
    backend/                    already exists - FastAPI application
    frontend/                   already exists - React/Vite application
    ontology/
        VSR_CMP_schema.ttl      CMPO schema (TBox), BFO-aligned
        Schema_instance_based.ttl   earlier AI-generated ontology draft
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

> Note: Industrial datasets are not included in this repository due to
> confidentiality agreements. The `data/` folder contains a representative
> sample only.

---

## Prerequisites

Before running the project, make sure you have:

- Python 3.10+
- Node.js 20+ and npm
- GraphDB (free edition) - https://graphdb.ontotext.com/
- Git

---

## 1. GraphDB Setup

1. Install GraphDB and open the workbench at `http://localhost:7200`
2. Go to **Setup -> Repositories -> Create new repository**
3. Set the repository name to `cmp_repo` and click **Create**
4. Go to **Import -> Upload RDF file**
5. Upload `ontology/VSR_CMP_schema.ttl` and `data/instances_v2.ttl`
6. Make sure the target repository is `cmp_repo` and click **Import**

---

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

---

## 3. Frontend Setup (React / Vite)

```
cd frontend
npm install
npm run dev
```

The portal will be available at `http://localhost:5173`.

---

## Next Steps

The current version is a single-ontology research prototype.
Planned future work includes extending the portal into a multi-ontology
editor where users can upload their own ontologies, supporting multiple
RDF formats, and integrating a SHACL playground for validation without
writing SPARQL.
