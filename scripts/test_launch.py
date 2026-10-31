"""Run: python3 -m unittest discover -s scripts -p 'test_*.py'"""

import os
import unittest

import launch


class NativeServerCommandTests(unittest.TestCase):
    def test_port_passed_via_env_not_flag(self):
        cmd, env = launch.native_server_cmd("8081")
        self.assertEqual(cmd, ["go", "run", "./cmd/server"])
        self.assertEqual(env["PORT"], "8081")
        self.assertEqual(env["PATH"], os.environ["PATH"])


if __name__ == "__main__":
    unittest.main()
