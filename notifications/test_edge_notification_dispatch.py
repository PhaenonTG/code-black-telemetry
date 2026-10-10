import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MODULE = Path(__file__).with_name("edge-discord-notify.py")
spec = importlib.util.spec_from_file_location("dispatch", MODULE)
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class DispatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.outbox = root / "outbox"
        self.outbox.mkdir()
        self.secret = root / "webhook"
        self.secret.write_text("https://discord.com/api/webhooks/test/secret")
        for name, value in (("BASE", root), ("OUTBOX", self.outbox), ("SENT", root / "sent"),
                            ("STATUS", root / "status.json"), ("STATE", root / "state.json"),
                            ("BRIDGE_HEALTH", root / "bridge-health.json"),
                            ("SECRET", self.secret)):
            patcher = patch.object(dispatch, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_ntfy_success_archives_without_discord(self):
        (self.outbox / "a.json").write_text(json.dumps({"type": "incident_start"}))
        with patch.object(dispatch, "send_emergency") as emergency:
            self.assertEqual(dispatch.dispatch(run_bridge=lambda: SimpleNamespace(returncode=0)), 0)
            emergency.assert_not_called()
        self.assertFalse((self.outbox / "a.json").exists())
        self.assertEqual(json.loads((dispatch.SENT / "a.json").read_text())["notification_delivery"]["provider"], "ntfy")

    def test_failed_ntfy_keeps_queue_and_emergency_is_deduplicated(self):
        (self.outbox / "a.json").write_text(json.dumps({"type": "incident_start"}))
        sent = []
        fail = lambda: SimpleNamespace(returncode=1, stdout="ntfy-health unavailable", stderr="")
        for _ in range(4):
            dispatch.dispatch(run_bridge=fail, send=lambda url, reason: sent.append(reason))
        self.assertEqual(len(sent), 1)
        self.assertTrue((self.outbox / "a.json").exists())
        self.assertEqual(json.loads(dispatch.STATUS.read_text())["fallback_failures"], 4)
        dispatch.dispatch(run_bridge=lambda: SimpleNamespace(returncode=0), send=lambda *_: None)
        self.assertEqual(json.loads(dispatch.STATE.read_text())["failures"], 0)
        self.assertFalse((self.outbox / "a.json").exists())

    def test_status_center_failure_does_not_trigger_emergency(self):
        sent = []
        def status_failure():
            dispatch.save(dispatch.BRIDGE_HEALTH, {"ok": False, "ntfy_delivery_ok": True,
                                                   "errors": ["status-center: unavailable"]})
            return SimpleNamespace(returncode=1, stdout="status-center: unavailable", stderr="")
        for _ in range(3):
            self.assertEqual(dispatch.dispatch(run_bridge=status_failure,
                                               send=lambda url, reason: sent.append(reason)), 1)
        self.assertEqual(sent, [])
        self.assertEqual(json.loads(dispatch.STATUS.read_text())["last_result"], "bridge_degraded")


if __name__ == "__main__":
    unittest.main()
