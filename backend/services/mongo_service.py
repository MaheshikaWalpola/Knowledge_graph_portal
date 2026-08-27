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