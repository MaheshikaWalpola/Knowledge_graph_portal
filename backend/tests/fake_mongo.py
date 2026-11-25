"""
In-memory stand-in for services.mongo_service, for tests that don't need a database.

Importing the real services.mongo_service connects to MongoDB (it creates indexes at import), so
call install() before importing code that uses it. Nothing is replaced if the real module is
already loaded.
"""
import json
import sys
import types

COLLECTIONS = ("users_collection", "user_schemas_collection", "chat_conversations_collection",
               "schema_history_collection", "ontology_checks_collection")


class FakeCollection:
    """Just enough of a pymongo collection for these tests (find_one with sort, insert_one)."""

    def __init__(self):
        self.docs = []

    def create_index(self, *args, **kwargs):
        return None

    def find_one(self, query, sort=None, projection=None):
        matches = [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]
        if sort:
            for key, direction in reversed(sort):
                matches.sort(key=lambda d: d.get(key) or "", reverse=direction < 0)
        return dict(matches[0]) if matches else None

    def insert_one(self, doc):
        self.docs.append(json.loads(json.dumps(doc)))  # store a copy, like a database would


def install() -> None:
    if "services.mongo_service" in sys.modules:
        return
    fake = types.ModuleType("services.mongo_service")
    for name in COLLECTIONS:
        setattr(fake, name, FakeCollection())
    sys.modules["services.mongo_service"] = fake
