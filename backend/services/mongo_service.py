from pymongo import MongoClient, ASCENDING, DESCENDING
from core.config import settings

client = MongoClient(settings.MONGODB_URI)
db = client[settings.MONGODB_DB]

users_collection = db["users"]

# Workspace schema metadata
user_schemas_collection = db["user_schemas"]
user_schemas_collection.create_index([("user_email", 1), ("schema_id", 1)], unique=True)
user_schemas_collection.create_index([("user_email", 1), ("created_at", -1)])

# AI Assistant chat conversations
chat_conversations_collection = db["chat_conversations"]
chat_conversations_collection.create_index([("user_email", ASCENDING), ("chat_id", ASCENDING)], unique=True)
chat_conversations_collection.create_index([("user_email", ASCENDING), ("updated_at", DESCENDING)])

# Canvas schema change history
schema_history_collection = db["schema_history"]
schema_history_collection.create_index([("user_email", ASCENDING), ("schema_id", ASCENDING), ("saved_at", DESCENDING)])
schema_history_collection.create_index([("saved_at", DESCENDING)])
# AI-generated SHACL shapes: one document per generated (or repaired) shape, see generation_log_service
shacl_generations_collection = db["shacl_generations"]
shacl_generations_collection.create_index([("generation_id", ASCENDING)], unique=True)
shacl_generations_collection.create_index([("user_email", ASCENDING), ("created_at", DESCENDING)])
shacl_generations_collection.create_index([("experiment_tag", ASCENDING), ("model_id", ASCENDING), ("statement_id", ASCENDING)])
shacl_generations_collection.create_index([("round_id", ASCENDING), ("created_at", ASCENDING)])

# Timing log: one document per run of a validation-page step (services/run_log_service.py)
validation_runs_collection = db["validation_runs"]
validation_runs_collection.create_index([("run_id", ASCENDING)], unique=True)
validation_runs_collection.create_index([("user_email", ASCENDING), ("started_at", DESCENDING)])
validation_runs_collection.create_index([("round_id", ASCENDING), ("step", ASCENDING)])
