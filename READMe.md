
## 🧩 0. Prerequisites

Before starting, make sure you have:

- 🐍 **Python 3.0+**
- ⚛️ **Node.js 20+** and **npm**
- 🗄️ **GraphDB**
- 💻 Git (optional but recommended)

Your project structure should look like this:

## 🗄️ 1. GraphDB Setup (Local)

1. **Install GraphDB**
   - Download and install GraphDB from  
     👉 [https://graphdb.ontotext.com/](https://graphdb.ontotext.com/)

2. **Open GraphDB Workbench**
   - Go to:  
     ```
     http://localhost:7200
     ```

3. **Create a Repository**
   - Navigate to: **Setup → Repositories → Create new repository**
   - Set the repository name to:
     ```
     cmp_repo
     ```
   - Leave all other settings as default and click **Create**

4. **Import RDF Data**
   - Go to **Import → Upload**
   - Choose the **two RDF files** provided via email
   - Select the `cmp_repo` repository
   - Click **Import**

Your local GraphDB now contains the RDF data for graph visualization.

---

## ⚙️ 2. Backend Setup (Python / FastAPI)

1. Clone the project Navigate to the backend directory:
   ```
   cd backend
   ```
2. Create a file named .env inside the backend folder and paste the environment variables that were shared via email

3. command for run the code:
```
python -m venv .venv
# Activate environment
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000

```
## ⚙️ 2. Frontend Setup (React/Vite)

1. Navigate to the frontend directory:

```
cd frontend

```
2. Install dependencies:

```
npm install

```
3. Run the app

```
npm run dev

```
