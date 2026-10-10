import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("edge_ntfy_bridge.py")
spec = importlib.util.spec_from_file_location("bridge", MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class HealthyResponse(io.BytesIO):
    status = 200


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.patchers = [
            patch.object(bridge, "EVENTS", self.root / "events.jsonl"),
            patch.object(bridge, "STATE", self.root / "state.json"),
            patch.object(bridge, "HEALTH", self.root / "health.json"),
            patch.object(bridge, "NOTIFICATION_DIR", self.root / "notifications"),
        ]
        for item in self.patchers:
            item.start()
            self.addCleanup(item.stop)
        bridge.EVENTS.write_text('{"type":"incident_start","issues":["old"]}\n')

    def test_baselines_existing_events_and_attention(self):
        item = {"id": "disk:core:/", "title": "Core disk full", "detail": "95%", "severity": "WARNING"}
        with patch.object(bridge, "get_attention", return_value={item["id"]: item}), patch.object(bridge, "publish") as send, \
             patch.object(bridge.urllib.request, "urlopen", return_value=HealthyResponse(b'{"healthy":true}')):
            self.assertEqual(bridge.main(), 0)
            send.assert_not_called()
        self.assertTrue(json.loads(bridge.HEALTH.read_text())["ok"])

    def test_new_attention_is_debounced_and_recovery_sent(self):
        item = {"id": "svc:api", "title": "API offline", "detail": "unreachable"}
        state = {"attention_baselined": True, "coverage_version": 2, "attention": {}, "event_offset": bridge.EVENTS.stat().st_size}
        with patch.object(bridge, "publish") as send, patch.object(bridge, "get_attention", return_value={item["id"]: item}):
            for _ in range(3):
                bridge.send_status_transitions(state)
            self.assertEqual(send.call_count, 1)
        with patch.object(bridge, "publish") as send, patch.object(bridge, "get_attention", return_value={}):
            bridge.send_status_transitions(state)
            self.assertEqual(send.call_count, 0)
            bridge.send_status_transitions(state)
            self.assertEqual(send.call_count, 1)

    def test_numeric_incident_updates_do_not_spam(self):
        state = {"event_offset": bridge.EVENTS.stat().st_size}
        with bridge.EVENTS.open("a") as out:
            out.write(json.dumps({"type": "incident_start", "issues": ["backup_stale:503"]}) + "\n")
            out.write(json.dumps({"type": "incident_update", "issues": ["backup_stale:504"]}) + "\n")
        with patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.send_edge_events(state), 1)
            self.assertEqual(send.call_count, 1)

    def test_info_is_status_only_and_escalation_pages(self):
        item = {"id": "wx:optional", "title": "Optional weather offline", "detail": "weather paused", "severity": "INFO"}
        state = {"attention_baselined": True, "coverage_version": 2, "attention": {}}
        payload = json.dumps({"attention": [item]}).encode()
        with patch.object(bridge.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
            self.assertEqual(bridge.get_attention(), {})
        with patch.object(bridge, "publish") as send, patch.object(bridge, "get_attention", return_value={}):
            for _ in range(3):
                bridge.send_status_transitions(state)
            send.assert_not_called()
            escalated = dict(item, severity="CRITICAL")
            with patch.object(bridge, "get_attention", return_value={item["id"]: escalated}):
                for _ in range(3):
                    bridge.send_status_transitions(state)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(send.call_args.args[2], "urgent")

    def test_coverage_migration_baselines_existing_info(self):
        item = {"id": "stream:tessa", "title": "TESSA offline", "detail": "normal", "severity": "INFO"}
        state = {"attention_baselined": True, "attention": {}}
        with patch.object(bridge, "get_attention", return_value={}), patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.send_status_transitions(state), 0)
            send.assert_not_called()
        self.assertEqual(state["coverage_version"], 2)

    def test_status_only_devices_are_not_pushed_or_recovered(self):
        item = {"id": "host:hytetower", "title": "HYTETOWER offline", "severity": "INFO"}
        payload = json.dumps({"attention": [item, {"id": "svc:nick-mesonet-wind", "severity": "INFO"},
                                            {"id": "svc:future-esp", "severity": "INFO", "status_only": True}]}).encode()
        with patch.object(bridge.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
            self.assertEqual(bridge.get_attention(), {})
        state = {"attention_baselined": True, "coverage_version": 2, "attention": {
            item["id"]: {"active": True, "notified": True, "title": item["title"]}}}
        with patch.object(bridge, "get_attention", return_value={}), patch.object(bridge, "publish") as send:
            bridge.send_status_transitions(state)
            send.assert_not_called()
        self.assertNotIn(item["id"], state["attention"])

    def test_unannounced_cold_start_unknown_recovery_is_silent(self):
        item = {"id": "svc:api", "title": "API UNKNOWN", "detail": "probe warming", "severity": "WARNING"}
        state = {"attention_baselined": True, "attention": {}}
        with patch.object(bridge, "get_attention", return_value={item["id"]: item}), patch.object(bridge, "publish") as send:
            bridge.send_status_transitions(state)
            with patch.object(bridge, "get_attention", return_value={}):
                bridge.send_status_transitions(state)
                bridge.send_status_transitions(state)
            send.assert_not_called()

    def test_other_edge_event_remains_status_only_across_outbox_move(self):
        outbox = bridge.NOTIFICATION_DIR / "outbox"
        sent_dir = bridge.NOTIFICATION_DIR / "sent"
        outbox.mkdir(parents=True)
        sent_dir.mkdir(parents=True)
        state = {}
        self.assertEqual(bridge.send_other_edge_events(state), 0)
        event = outbox / "stream-live.json"
        event.write_text(json.dumps({"type": "stream_live", "stream": {"owner": "Nick", "provider": "YouTube"}}))
        with patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.send_other_edge_events(state), 0)
            event.rename(sent_dir / event.name)
            self.assertEqual(bridge.send_other_edge_events(state), 0)
            self.assertEqual(send.call_count, 0)

    def test_snoozed_attention_pages_when_snooze_expires(self):
        item = {"id": "svc:api", "title": "API offline", "detail": "unreachable", "severity": "WARNING"}
        state = {"attention_baselined": True, "coverage_version": 2, "attention": {}}
        with patch.object(bridge, "get_attention", return_value={item["id"]: item}), \
             patch.object(bridge, "snoozed", side_effect=[True, False]), \
             patch.object(bridge, "publish") as send:
            for _ in range(4):
                bridge.send_status_transitions(state)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(send.call_args.args[-1], "svc:api")


if __name__ == "__main__":
    unittest.main()
