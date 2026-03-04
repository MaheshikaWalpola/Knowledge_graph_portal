from pymongo import MongoClient
from core.config import settings

client = MongoClient(settings.MONGODB_URI)
db = client[settings.MONGODB_DB]

users_collection = db["users"]

# NEW: store workspace schema metadata
user_schemas_collection = db["user_schemas"]

user_schemas_collection.create_index([("user_email", 1), ("schema_id", 1)], unique=True)
user_schemas_collection.create_index([("user_email", 1), ("created_at", -1)])