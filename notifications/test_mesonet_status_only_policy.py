import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("mesonet_status_only_policy", Path(__file__).with_name("mesonet_status_only_policy.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def test_transform_once_and_idempotent(self):
        source = "SELECT * FROM mesonet_alerts WHERE kind!='stale' AND retry_at<=?"
        updated, changed = policy.transform(source)
        self.assertTrue(changed)
        self.assertIn("kind NOT IN ('stale','offline')", updated)
        self.assertEqual(policy.transform(updated), (updated, False))

    def test_unknown_source_is_rejected(self):
        with self.assertRaises(ValueError):
            policy.transform("SELECT * FROM mesonet_alerts")


if __name__ == "__main__":
    unittest.main()
