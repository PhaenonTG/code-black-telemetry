#!/usr/bin/env python3
"""Deterministic tests for the Status Center change log (bounded, debounced state transitions)."""
import copy
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-changes-"))
import server  # noqa: E402

server.CHANGE_CONFIRM_S = 10


def make_doc(edge="HEALTHY", radar="FRESH", striker="OFFLINE", attention=None, overall="HEALTHY", svc_state="HEALTHY", cpu=5):
    return {
        "summary": {"overall": overall},
        "hosts": [{"id": "edge", "name": "EDGE", "state": edge, "expected_online": True, "cpu": {"percent": cpu}}],
        "services": [{"id": "svc-a", "name": "Service A", "state": svc_state}],
        "streaming": {"state": "LIVE" if striker == "LIVE" else "OFFLINE", "broadcast": None,
                      "sources": [{"id": "STRIKER", "name": "STRIKER", "state": striker}]},
        "radar": {"state": radar},
        "weather": {"items": [{"id": "hrrr", "name": "HRRR", "state": "HEALTHY"}]},
        "dns": {"instances": [{"id": "pihole", "name": "Pi-hole", "state": "HEALTHY"}]},
        "ai": {"state": "HEALTHY"}, "compute": {"state": "IDLE"},
        "network": {"tailscale": {"state": "HEALTHY"}, "internet": {"state": "HEALTHY"}},
        "storage": {"state": "HEALTHY", "backups": []},
        "attention": attention or [],
    }


class ChangeLogTests(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(prefix="cl-"), "changes.json")
        self.cl = server.ChangeLog(self.path)

    def drive(self, doc, start, seconds, step=2):
        for t in range(0, seconds + 1, step):
            self.cl.observe(doc, start + t)

    def test_baseline_is_silent(self):
        self.drive(make_doc(), 1000, 60)
        self.assertEqual(self.cl.query()["events"], [])

    def test_transition_recorded_after_debounce(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(edge="DEGRADED"), 1012, 20)
        ev = self.cl.query()["events"]
        self.assertEqual(len(ev), 1)
        self.assertEqual((ev[0]["key"], ev[0]["from"], ev[0]["to"], ev[0]["direction"]), ("host:edge", "HEALTHY", "DEGRADED", "degraded"))
        self.drive(make_doc(edge="HEALTHY"), 1040, 20)
        ev = self.cl.query()["events"]
        self.assertEqual([e["to"] for e in ev], ["DEGRADED", "HEALTHY"])
        self.assertEqual(ev[-1]["direction"], "improved")

    def test_transient_blip_never_recorded(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(edge="OFFLINE"), 1012, 4)  # shorter than the debounce window
        self.drive(make_doc(), 1018, 40)
        self.assertEqual(self.cl.query()["events"], [])

    def test_numeric_fluctuation_is_not_an_event(self):
        self.drive(make_doc(cpu=5), 1000, 10)
        for i, cpu in enumerate([5, 90, 12, 77, 3, 100, 0]):
            self.drive(make_doc(cpu=cpu), 1012 + i * 20, 18)
        self.assertEqual(self.cl.query()["events"], [])

    def test_attention_raised_and_cleared(self):
        self.drive(make_doc(), 1000, 10)
        att = [{"id": "disk:x", "severity": "WARNING", "title": "PHAENON3 disk 90% used"}]
        self.drive(make_doc(attention=att), 1012, 20)
        self.drive(make_doc(), 1040, 24)
        ev = self.cl.query()["events"]
        self.assertEqual([e["summary"] for e in ev], ["Attention raised (WARNING): PHAENON3 disk 90% used", "Attention cleared: PHAENON3 disk 90% used"])

    def test_info_attention_not_tracked(self):
        self.drive(make_doc(), 1000, 10)
        att = [{"id": "stream:STRIKER", "severity": "INFO", "title": "STRIKER offline"}]
        self.drive(make_doc(attention=att), 1012, 40)
        self.assertEqual(self.cl.query()["events"], [])

    def test_stream_offline_to_live_is_neutral_change(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(striker="LIVE"), 1012, 20)
        e = self.cl.query()["events"][0]
        self.assertEqual((e["from"], e["to"], e["direction"]), ("OFFLINE", "LIVE", "changed"))

    def test_radar_freshness_transitions(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(radar="AGING"), 1012, 20)
        self.drive(make_doc(radar="STALE"), 1040, 20)
        self.assertEqual([(e["from"], e["to"]) for e in self.cl.query()["events"]], [("FRESH", "AGING"), ("AGING", "STALE")])

    def test_survives_restart_and_catches_change_during_downtime(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(edge="DEGRADED"), 1012, 20)
        self.assertEqual(len(self.cl.query()["events"]), 1)
        cl2 = server.ChangeLog(self.path)  # restart: events + baseline reloaded
        self.assertEqual(len(cl2.query()["events"]), 1)
        for t in range(0, 30, 2):
            cl2.observe(make_doc(edge="HEALTHY"), 5000 + t)  # recovered while we were down
        self.assertEqual([e["to"] for e in cl2.query()["events"]], ["DEGRADED", "HEALTHY"])
        cl3 = server.ChangeLog(self.path)
        for t in range(0, 30, 2):
            cl3.observe(make_doc(edge="HEALTHY"), 6000 + t)  # nothing changed: no spurious event after another restart
        self.assertEqual(len(cl3.query()["events"]), 2)

    def test_bounded_by_count_and_age(self):
        old_max, old_age = server.CHANGE_MAX_EVENTS, server.CHANGE_MAX_AGE_S
        server.CHANGE_MAX_EVENTS, server.CHANGE_MAX_AGE_S = 5, 3600
        try:
            self.drive(make_doc(), 0, 10)
            t = 100
            for i in range(20):
                self.drive(make_doc(edge="DEGRADED" if i % 2 == 0 else "HEALTHY"), t, 14)
                t += 20
            self.assertLessEqual(len(self.cl.query()["events"]), 5)
            self.cl.observe(make_doc(edge="HEALTHY"), t + 10_000)  # everything is now older than the age limit
            self.assertEqual(self.cl.query()["events"], [])
        finally:
            server.CHANGE_MAX_EVENTS, server.CHANGE_MAX_AGE_S = old_max, old_age

    def test_query_since_filters(self):
        self.drive(make_doc(), 1000, 10)
        self.drive(make_doc(edge="DEGRADED"), 1012, 20)
        self.drive(make_doc(edge="HEALTHY"), 1040, 20)
        self.assertEqual(len(self.cl.query(since=1035)["events"]), 1)
        self.assertEqual(len(self.cl.query(since=5000)["events"]), 0)

    def test_signature_contains_no_numbers(self):
        sig = server.significant_signature(make_doc(cpu=93))
        self.assertTrue(all(isinstance(v[0], str) for v in sig.values()))

    def test_persist_failure_does_not_break_tracking(self):
        cl = server.ChangeLog(os.path.join(tempfile.mkdtemp(), "blocked", "x", "changes.json"))
        cl.path = os.path.join(os.devnull, "cannot", "changes.json")
        self.drive_cl = cl
        for t in range(0, 12, 2):
            cl.observe(make_doc(), 1000 + t)
        for t in range(0, 24, 2):
            cl.observe(make_doc(edge="OFFLINE"), 1020 + t)
        self.assertEqual(len(cl.query()["events"]), 1)
        self.assertFalse(cl.query()["persisted"])


class WarmupTests(unittest.TestCase):
    def test_observer_waits_for_probe_warmup(self):
        class P:
            def __init__(self, attempted): self.last_attempt = 1.0 if attempted else None
        old_probes, old_start = dict(server.PROBES), server.START
        try:
            server.START = server.time.time() - 100
            server.PROBES.clear(); server.PROBES.update({"a": P(True), "b": P(False)})
            self.assertFalse(server.probes_warmed())  # one probe has not completed a first attempt
            server.PROBES["b"] = P(True)
            self.assertTrue(server.probes_warmed())
            server.START = server.time.time() - 2
            self.assertFalse(server.probes_warmed())  # process too young even if attempts exist
        finally:
            server.PROBES.clear(); server.PROBES.update(old_probes); server.START = old_start


if __name__ == "__main__":
    unittest.main(verbosity=2)
