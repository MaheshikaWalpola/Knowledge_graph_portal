"""
Tests for saving a schema to the workspace (ctrl_upload_schema):
a save that fails because the new content doesn't parse must leave the stored schema untouched.
Before the fix, an update deleted the old schema first and only then parsed the new content.
"""

import io
import unittest
from unittest.mock import patch

from tests.fake_mongo import install as install_fake_mongo

# Importing services.mongo_service connects to MongoDB; these tests don't need a database.
install_fake_mongo()

from fastapi import HTTPException, UploadFile  # noqa: E402

from controllers import controller  # noqa: E402

VALID_TTL = b"""
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix ex: <http://example.org/onto#> .
ex:Wafer a owl:Class .
"""

# What the canvas writes for an owl:hasKey list: a bare blank-node name, not valid Turtle.
INVALID_TTL = VALID_TTL + b"n0123456789abcdef0123456789abcdef a owl:Class .\n"


def upload(content: bytes, filename: str = "My_onto.ttl") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=filename)


class TestSchemaUploadUpdate(unittest.TestCase):

    def setUp(self):
        self.events = []
        patches = {
            "list_user_schemas": lambda user: [{"name": "My onto", "schema_id": "My_onto_1"}],
            "ctrl_delete_user_schema": lambda user, sid: self.events.append(("delete", sid)),
            "import_turtle_to_named_graph": lambda ttl, graph: self.events.append(("import", graph)),
            "delete_named_graph": lambda graph: self.events.append(("drop", graph)),
            "create_schema_meta": lambda **kw: {"schema_id": kw["schema_id"], "name": kw["name"]},
        }
        for name, fake in patches.items():
            patcher = patch.object(controller, name, fake)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, content, mode="combined", instances=None):
        return controller.ctrl_upload_schema("u@example.org", "My onto", mode, upload(content),
                                             instances, update_schema_id="My_onto_1")

    def test_invalid_update_keeps_the_stored_schema(self):
        with self.assertRaises(HTTPException) as ctx:
            self.save(INVALID_TTL)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("invalid syntax", ctx.exception.detail["summary"])
        self.assertEqual(self.events, [])  # nothing deleted, nothing imported

    def test_invalid_instances_file_keeps_the_stored_schema(self):
        with self.assertRaises(HTTPException) as ctx:
            self.save(VALID_TTL, mode="separate", instances=upload(INVALID_TTL, "data.ttl"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.events, [])

    def test_missing_instances_file_keeps_the_stored_schema(self):
        with self.assertRaises(HTTPException) as ctx:
            self.save(VALID_TTL, mode="separate", instances=None)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(self.events, [])

    def test_valid_update_replaces_the_schema(self):
        result = self.save(VALID_TTL)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(self.events[0], ("delete", "My_onto_1"))
        self.assertEqual(self.events[1][0], "import")

    def test_valid_separate_update_imports_both_graphs(self):
        result = self.save(VALID_TTL, mode="separate", instances=upload(VALID_TTL, "data.ttl"))
        self.assertEqual(result["status"], "ok")
        self.assertEqual([e[0] for e in self.events], ["delete", "import", "import"])


if __name__ == "__main__":
    unittest.main()
