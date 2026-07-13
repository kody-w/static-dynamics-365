from __future__ import annotations

import functools
import hashlib
import http.server
import json
import threading
import unittest
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


class HttpSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address
        cls.root_base = f"http://{host}:{port}/"
        cls.base = cls.root_base + "site/"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def fetch(self, relative: str) -> tuple[int, str, bytes]:
        with urllib.request.urlopen(self.base + relative, timeout=3) as response:
            return response.status, response.headers.get_content_type(), response.read()

    def fetch_root(self, relative: str) -> tuple[int, str, bytes]:
        with urllib.request.urlopen(self.root_base + relative, timeout=3) as response:
            return response.status, response.headers.get_content_type(), response.read()

    def test_root_and_every_module_load_under_a_project_subpath(self) -> None:
        for relative, content_type in [
            ("", "text/html"),
            ("styles.css", "text/css"),
            ("app.mjs", "text/javascript"),
            ("app-helpers.mjs", "text/javascript"),
            ("twin-core.mjs", "text/javascript"),
            ("tenant-schema.mjs", "text/javascript"),
            ("data/seed.json", "application/json"),
            ("data/schema.json", "application/json"),
            ("manifest.webmanifest", "application/manifest+json"),
        ]:
            status, actual_type, payload = self.fetch(relative)
            self.assertEqual(status, 200, relative)
            self.assertTrue(payload, relative)
            if relative.endswith(".mjs"):
                self.assertIn(actual_type, {"text/javascript", "application/javascript"})
            else:
                self.assertEqual(actual_type, content_type)

    def test_all_static_api_routes_return_valid_json(self) -> None:
        registry = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
        for entry in registry["files"]:
            status, content_type, payload = self.fetch_root(entry["path"])
            self.assertEqual(status, 200, entry["path"])
            self.assertTrue(payload, entry["path"])
            self.assertEqual(
                hashlib.sha256(payload).hexdigest(),
                entry["sha256"],
                entry["path"],
            )
            if entry["path"].endswith(".json"):
                self.assertEqual(content_type, "application/json")
                self.assertIsInstance(json.loads(payload), dict)

    def test_deployed_root_is_the_live_application(self) -> None:
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<script type="module" src="./app.mjs"></script>', html)
        self.assertNotIn("/d" + "365/", html)


if __name__ == "__main__":
    unittest.main()
