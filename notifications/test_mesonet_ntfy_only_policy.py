import unittest

from notifications.mesonet_ntfy_only_policy import (
    NEW_ENDPOINT, NEW_STATUS, OLD_ENDPOINT, OLD_STATUS, transform,
)


class PolicyTests(unittest.TestCase):
    def test_guarded_idempotent_transform(self):
        original = f"def endpoint():\n    {OLD_ENDPOINT}\ndef status():\n    {OLD_STATUS}\n"
        updated, changed = transform(original)
        self.assertTrue(changed)
        self.assertIn(NEW_ENDPOINT, updated)
        self.assertIn(NEW_STATUS, updated)
        self.assertNotIn(OLD_ENDPOINT, updated)
        self.assertNotIn(OLD_STATUS, updated)
        self.assertEqual(transform(updated), (updated, False))

    def test_unknown_source_refused(self):
        with self.assertRaises(ValueError):
            transform("changed upstream")


if __name__ == "__main__":
    unittest.main()
