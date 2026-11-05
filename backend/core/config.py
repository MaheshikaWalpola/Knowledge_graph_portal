import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    GRAPHDB_BASE_URL   = os.getenv("GRAPHDB_BASE_URL")
    GRAPHDB_REPOSITORY = os.getenv("GRAPHDB_REPOSITORY")

    CMP_NS          = os.getenv("CMP_NS")
    CMP_INSTANCE_NS = os.getenv("CMP_INSTANCE_NS")

    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

    # Path prefix under which the reverse proxy serves the API (e.g. /knowledgegraphportal/api); empty locally.
    # Lets FastAPI generate correct URLs for /docs and the OpenAPI schema behind the proxy.
    API_ROOT_PATH = os.getenv("API_ROOT_PATH", "").rstrip("/")

    BASE_SCHEMA_GRAPH = os.getenv("BASE_SCHEMA_GRAPH")
    BASE_INSTANCE_GRAPH = os.getenv("BASE_INSTANCE_GRAPH")

    # MongoDB
    MONGODB_URI = os.getenv("MONGODB_URI")
    MONGODB_DB  = os.getenv("MONGODB_DB")

    # JWT
    JWT_SECRET    = os.getenv("JWT_SECRET")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

    # Email
    # Public URL of the frontend incl. any path prefix; used to build links in e-mails
    FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
    SMTP_USER   = os.getenv("SMTP_USER")
    SMTP_PASS   = os.getenv("SMTP_PASS")
    MAIL_FROM   = os.getenv("MAIL_FROM", SMTP_USER)
    MAIL_PORT   = int(os.getenv("MAIL_PORT", "587"))
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")

    # OpenAI
    OPEN_API_KEY = os.getenv("OPEN_API_KEY")

    # SHACL Verification & Repair Pipeline
    ENABLE_SHACL_VERIFICATION = os.getenv("ENABLE_SHACL_VERIFICATION", "true").lower() in ("true", "1", "yes")

settings = Settings()

