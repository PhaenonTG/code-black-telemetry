"""A dated directory is not a completed or verified backup."""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-backup-"))
import server  # noqa: E402


ROOT = "/srv/codeblack/backups/core/snapshots"
OLD = "20261002T001700Z"
NEW = "20261003T003220Z"
AT = datetime(2026, 10, 3, 3, 30, tzinfo=timezone.utc).timestamp()


def observed(newest=NEW, verified=OLD, pull="success", complete=True):
    return {
        "newest": {"core-snapshots": {"newest_file": newest, "count": 34,
                                      "mtime": "2026-10-03T00:32:20Z", "age_s": 10660}},
        "files": {"backup-verification": {"json": {
            "generated_at": "2026-10-03T03:30:00Z", "status": "healthy",
            "snapshot": f"{ROOT}/{verified}", "backup_complete": complete,
            "inventory_present": True, "repositories_checked": 2,
            "repositories_expected": 2,
        }}},
        "units": {"codeblack-core-backup.service": {"result": pull}},
    }


class BackupHealthTests(unittest.TestCase):
    def test_collector_requests_verification_identity(self):
        edge = server.HOSTS["edge"]
        item = next(item for item in edge["checks"]["files"] if item["name"] == "backup-verification")
        self.assertIn("snapshot", item["pick"])
        self.assertIn("inventory_present", item["pick"])

    def build(self, doc):
        with patch.object(server, "coll", return_value=(doc, {}, True)), patch.object(server, "now", return_value=AT):
            return server.build_storage([])["backups"][0]

    def test_failed_new_directory_does_not_advance_last_backup(self):
        backup = self.build(observed())
        self.assertEqual(backup["state"], "DEGRADED")
        self.assertEqual(backup["last_backup"], "2026-10-02T00:17:00Z")
        self.assertGreater(backup["age_s"], 24 * 3600)
        detail = {entry["label"]: entry["value"] for entry in backup["detail"]}
        self.assertEqual(detail["newest directory"], NEW)
        self.assertEqual(detail["verified snapshot"], OLD)
        self.assertIs(detail["newest verified"], False)

    def test_matching_verified_backup_is_healthy(self):
        backup = self.build(observed(verified=NEW))
        self.assertEqual(backup["state"], "HEALTHY")
        self.assertEqual(backup["last_backup"], "2026-10-03T00:32:20Z")

    def test_failed_pull_or_incomplete_verification_cannot_be_healthy(self):
        self.assertEqual(self.build(observed(verified=NEW, pull="exit-code"))["state"], "DEGRADED")
        self.assertEqual(self.build(observed(verified=NEW, complete=False))["state"], "DEGRADED")

    def test_untrusted_verification_path_is_rejected(self):
        doc = observed(verified=NEW)
        doc["files"]["backup-verification"]["json"]["snapshot"] = "/tmp/" + NEW
        backup = self.build(doc)
        self.assertEqual(backup["state"], "DEGRADED")
        self.assertIsNone(backup["last_backup"])

    def test_missing_verification_identity_is_not_healthy(self):
        doc = observed(verified=NEW)
        del doc["files"]["backup-verification"]["json"]["snapshot"]
        backup = self.build(doc)
        self.assertEqual(backup["state"], "DEGRADED")
        self.assertIsNone(backup["last_backup"])


if __name__ == "__main__":
    unittest.main()
