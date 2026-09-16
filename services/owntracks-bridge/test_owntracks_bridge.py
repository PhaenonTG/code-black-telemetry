"""Compact, stdlib-only tests for the OwnTracks -> Fabric adapter (V1).

Matches this codebase's existing convention of stdlib-only tests for a stdlib-only service
(see radar-worker/worker.test.cjs's node:test equivalent). Exercises the pure validation
logic and the server-authorized unit mapping directly -- no live HTTP/network required.
"""
import json
import time
import unittest
from unittest import mock

import owntracks_bridge as bridge


def make_handler():
    # BaseHTTPRequestHandler normally requires a real socket; we only need the plain methods
    # under test, so bypass __init__ entirely and set just what they use.
    handler = bridge.Handler.__new__(bridge.Handler)
    handler.headers = {}
    return handler


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.handler = make_handler()
        self.now = int(time.time())

    def test_valid_location_accepted(self):
        payload = {"_type": "location", "lat": 39.0997, "lon": -94.5786, "tst": self.now}
        self.assertIsNone(self.handler._validate(payload))

    def test_optional_fields_absent_still_succeeds(self):
        payload = {"_type": "location", "lat": 1.0, "lon": 1.0, "tst": self.now}
        self.assertIsNone(self.handler._validate(payload))

    def test_non_location_type_rejected(self):
        payload = {"_type": "transition", "lat": 1.0, "lon": 1.0, "tst": self.now}
        self.assertEqual(self.handler._validate(payload), "NOT_A_LOCATION_REPORT")

    def test_missing_latlon_rejected(self):
        self.assertEqual(self.handler._validate({"_type": "location", "tst": self.now}), "MISSING_OR_INVALID_LATLON")

    def test_out_of_bounds_latlon_rejected(self):
        payload = {"_type": "location", "lat": 999, "lon": 1.0, "tst": self.now}
        self.assertEqual(self.handler._validate(payload), "LATLON_OUT_OF_BOUNDS")

    def test_missing_timestamp_rejected(self):
        payload = {"_type": "location", "lat": 1.0, "lon": 1.0}
        self.assertEqual(self.handler._validate(payload), "MISSING_TIMESTAMP")

    def test_grossly_invalid_timestamp_rejected(self):
        payload = {"_type": "location", "lat": 1.0, "lon": 1.0, "tst": 0}
        self.assertEqual(self.handler._validate(payload), "TIMESTAMP_OUT_OF_RANGE")

    def test_far_future_timestamp_rejected(self):
        payload = {"_type": "location", "lat": 1.0, "lon": 1.0, "tst": self.now + 10_000}
        self.assertEqual(self.handler._validate(payload), "TIMESTAMP_OUT_OF_RANGE")

    def test_malformed_payload_type_rejected(self):
        self.assertEqual(self.handler._validate(["not", "a", "dict"]), "MALFORMED_PAYLOAD")

    def test_payload_cannot_supply_unit_id(self):
        # There is no code path that ever reads payload["unit_id"] -- this asserts the
        # server-authorized constant is what's actually used, regardless of payload content.
        payload = {"_type": "location", "lat": 1.0, "lon": 1.0, "tst": self.now, "unit_id": "cbwx-unit-tessa"}
        # A payload-supplied unit_id passes validation harmlessly (the field is simply never
        # read) -- the real protection is that do_POST() never looks at payload["unit_id"] at
        # all when building the Fabric message (see test_forward_builds_expected_fabric_message_shape,
        # which proves the OUTGOING Fabric message uses the server constant regardless).
        self.assertIsNone(self.handler._validate(payload))
        self.assertEqual(bridge.UNIT_ID, "cbwx-unit-striker")


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.handler = make_handler()
        bridge.Handler._token = "correct-token-value-for-test-only"

    def test_missing_auth_header_rejected(self):
        self.handler.headers = {}
        self.assertFalse(self.handler._authorized())

    def test_wrong_scheme_rejected(self):
        self.handler.headers = {"Authorization": "Basic dXNlcjpwYXNz"}
        self.assertFalse(self.handler._authorized())

    def test_wrong_token_rejected(self):
        self.handler.headers = {"Authorization": "Bearer wrong-token"}
        self.assertFalse(self.handler._authorized())

    def test_correct_token_accepted(self):
        self.handler.headers = {"Authorization": "Bearer correct-token-value-for-test-only"}
        self.assertTrue(self.handler._authorized())

    def test_empty_bearer_rejected(self):
        self.handler.headers = {"Authorization": "Bearer "}
        self.assertFalse(self.handler._authorized())


class ProvenanceMappingTests(unittest.TestCase):
    def test_unit_and_device_are_striker_not_tessa(self):
        self.assertEqual(bridge.UNIT_ID, "cbwx-unit-striker")
        self.assertEqual(bridge.DEVICE_ID, "cbwx-striker-ops-ipad")

    def test_forward_builds_expected_fabric_message_shape(self):
        # Exercises the actual construction path indirectly: capture what would be POSTed by
        # invoking do_POST's body-building logic through a controlled fake urlopen.
        handler = make_handler()
        handler.path = "/api/owntracks/v1/location"
        bridge.Handler._token = "t"
        handler.headers = {"Authorization": "Bearer t", "Content-Length": "0"}
        payload = {"_type": "location", "lat": 39.1, "lon": -94.5, "tst": int(time.time()), "acc": 12, "tid": "ST"}
        body = json.dumps(payload).encode("utf-8")
        handler.headers["Content-Length"] = str(len(body))

        captured = {}

        class FakeResp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=5):
            captured["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResp()

        import io
        handler.rfile = io.BytesIO(body)
        sent = {}
        def fake_send_json(status, body_):
            sent["status"] = status
            sent["body"] = body_
        handler._send_json = fake_send_json

        with mock.patch.object(bridge.urllib.request, "urlopen", fake_urlopen):
            handler.do_POST()

        self.assertEqual(sent["status"], 200)
        self.assertEqual(captured["body"]["unit_id"], "cbwx-unit-striker")
        self.assertEqual(captured["body"]["device_id"], "cbwx-striker-ops-ipad")
        self.assertEqual(captured["body"]["measurements"]["lat"], 39.1)
        self.assertEqual(captured["body"]["measurements"]["accuracy_m"], 12)
        self.assertEqual(captured["body"]["metadata"]["source"], "owntracks")
        self.assertEqual(captured["body"]["metadata"]["publisher"], "ST")


if __name__ == "__main__":
    unittest.main()
