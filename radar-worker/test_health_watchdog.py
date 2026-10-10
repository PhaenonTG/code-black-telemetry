"""Watchdog recovery policy checks; no real services are touched."""

import unittest

from health_watchdog import should_restart


class WatchdogTests(unittest.TestCase):
    def test_four_consecutive_failed_checks_restart(self):
        state = {}
        for minute in range(4):
            state, restart = should_restart(state, True, False, 1000 + minute * 60)
        self.assertTrue(restart)
        self.assertEqual(state["restart_count"], 1)
        self.assertEqual(state["failures"], 0)

    def test_recovery_and_long_gap_reset_failures(self):
        state, _ = should_restart({}, True, False, 1000)
        state, _ = should_restart(state, True, True, 1060)
        state, restart = should_restart(state, True, False, 1120)
        self.assertFalse(restart)
        self.assertEqual(state["failures"], 1)
        state, restart = should_restart(state, True, False, 1500)
        self.assertFalse(restart)
        self.assertEqual(state["failures"], 1)

    def test_inactive_service_is_left_to_systemd(self):
        state, restart = should_restart({"failures": 3}, False, False, 1000)
        self.assertFalse(restart)
        self.assertEqual(state["failures"], 0)

    def test_cooldown_prevents_restart_loop(self):
        state = {"last_restart": 1000, "restart_count": 1}
        for minute in range(4):
            state, restart = should_restart(state, True, False, 1100 + minute * 60)
        self.assertFalse(restart)
        self.assertEqual(state["restart_count"], 1)


if __name__ == "__main__":
    unittest.main()
