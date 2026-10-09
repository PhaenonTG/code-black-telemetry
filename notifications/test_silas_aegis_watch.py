import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from silas_aegis_watch import chunks, main, run


class SilasWatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.database = root / "audit.db"
        self.state = root / "state.json"
        token_file = root / "token.txt"
        token_file.write_text("test-token", encoding="utf-8")
        self.config = {"database": str(self.database), "state_file": str(self.state),
                       "token_file": str(token_file), "user_id": "silas", "endpoint": "https://example.invalid/topic"}
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("CREATE TABLE discussion_audit (message_id TEXT, created_at TEXT, session_id TEXT, "
                       "user_id TEXT, role TEXT, content TEXT)")
            db.commit()

    def add(self, message_id, created_at, role, content):
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("INSERT INTO discussion_audit VALUES (?,?,?,?,?,?)",
                       (message_id, created_at, "session-1", "silas", role, content))
            db.commit()

    def test_baselines_old_messages_then_sends_each_new_turn_once(self):
        self.add("old", "2026-10-07T01:00:00Z", "user", "old private text")
        sent = []
        publish = lambda endpoint, token, title, body: sent.append((title, body))
        self.assertEqual(run(self.config, publish_message=publish), 0)
        self.assertEqual(sent, [])
        self.add("u1", "2026-10-09T01:00:00Z", "user", "Hi")
        self.add("a1", "2026-10-09T01:00:01Z", "assistant", "Hello")
        self.assertEqual(run(self.config, publish_message=publish), 2)
        self.assertEqual([body for _, body in sent], ["Hi", "Hello"])
        self.assertEqual(run(self.config, publish_message=publish), 0)

    def test_retries_failed_part_without_losing_message(self):
        self.assertEqual(run(self.config, publish_message=lambda *_: None), 0)
        text = "🌪" * 1000
        self.add("m1", "2026-10-09T01:00:00Z", "user", text)
        emitted = []
        def fail_second(endpoint, token, title, body):
            if len(emitted) == 1:
                raise OSError("offline")
            emitted.append(body)
        with self.assertRaises(OSError):
            run(self.config, publish_message=fail_second)
        self.assertEqual(json.loads(self.state.read_text())["next_part"], 1)
        self.assertEqual(run(self.config, publish_message=lambda e, t, h, b: emitted.append(b)), 1)
        self.assertEqual("".join(emitted), text)
        self.assertEqual(run(self.config, publish_message=lambda *_: None), 0)

    def test_utf8_parts_preserve_full_text(self):
        original = "a🌪" * 1000
        self.assertEqual("".join(chunks(original)), original)
        self.assertTrue(all(len(part.encode("utf-8")) <= 3000 for part in chunks(original)))

    def test_successful_run_updates_heartbeat(self):
        heartbeat = Path(self.temp.name) / "heartbeat.json"
        self.config["heartbeat_file"] = str(heartbeat)
        config_path = Path(self.temp.name) / "config.json"
        config_path.write_text(json.dumps(self.config), encoding="utf-8")
        with patch("sys.argv", ["silas_aegis_watch.py", str(config_path)]):
            self.assertEqual(main(), 0)
        self.assertIn("at", json.loads(heartbeat.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
