import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("incident_actions.py")
spec = importlib.util.spec_from_file_location("actions", MODULE)
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


class IncidentActionsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        p = patch.object(actions, "ROOT", root)
        p.start()
        self.addCleanup(p.stop)

    def test_ack_and_snooze_do_not_hide_alert(self):
        base = time.time()
        self.assertEqual(actions.apply_action("svc:ntfy-private", "ack", at=base)
                         ["svc:ntfy-private"]["acknowledged_at"], actions.utc(base))
        state = actions.apply_action("svc:ntfy-private", "snooze", minutes=60, at=base)
        self.assertEqual(state["svc:ntfy-private"]["snoozed_until"], actions.utc(base + 3600))
        self.assertIsNone(actions.public_state(at=base + 3601)["svc:ntfy-private"]["snoozed_until"])
        self.assertEqual(json.loads((actions.ROOT / "state.json").read_text())["svc:ntfy-private"]["acknowledged_at"], actions.utc(base))

    def test_invalid_targets_and_durations_rejected(self):
        self.assertIn("stream:TESSA", actions.apply_action("stream:TESSA", "ack"))
        self.assertIn("disk:phaenon3:C:\\", actions.apply_action("disk:phaenon3:C:\\", "ack"))
        for alert_id in ("", "../../etc/passwd", "svc:<script>", "a" * 129):
            with self.assertRaises(ValueError):
                actions.apply_action(alert_id, "ack")
        with self.assertRaises(ValueError):
            actions.apply_action("svc:test", "snooze", minutes=99999)
        self.assertEqual(set(actions.read_state()), {"stream:TESSA", "disk:phaenon3:C:\\"})

    def test_csrf_nonce_single_use(self):
        value = actions.nonce()
        self.assertTrue(actions.consume_nonce(value))
        self.assertFalse(actions.consume_nonce(value))

    def test_mobile_form_origin_policy_keeps_nonce_as_primary_csrf_check(self):
        base = "https://codeblack-core.tail1d0673.ts.net"
        self.assertTrue(actions.request_origin_ok(base, None, "same-origin"))
        self.assertTrue(actions.request_origin_ok(base + ":443", None, "same-origin"))
        self.assertTrue(actions.request_origin_ok(None, base + "/alert-actions/incident?id=test", None))
        self.assertTrue(actions.request_origin_ok(None, None, None))
        self.assertTrue(actions.request_origin_ok("null", None, None))
        self.assertFalse(actions.request_origin_ok("https://evil.example", base + "/alert-actions/incident", None))
        self.assertFalse(actions.request_origin_ok(None, "https://evil.example/", None))
        self.assertFalse(actions.request_origin_ok(base, None, "cross-site"))

    def test_read_only_state_has_no_credentials(self):
        actions.apply_action("edge:incident", "snooze", minutes=15)
        state = actions.public_state()
        self.assertEqual(set(state["edge:incident"]), {"acknowledged_at", "snoozed_until"})


if __name__ == "__main__":
    unittest.main()
