"""Offline contract tests for the AXIVESTRA SearXNG gateway."""
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import unittest

MODULE_PATH = Path(__file__).with_name("gateway.py")
spec = importlib.util.spec_from_file_location("axivestra_search_gateway", MODULE_PATH)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class FakeSearxHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"results": [{"title": "Fixture", "url": "https://example.org/"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class GatewayReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeSearxHandler)
        cls.upstream_thread = Thread(target=cls.upstream.serve_forever, daemon=True)
        cls.upstream_thread.start()
        gateway.UPSTREAM = "http://127.0.0.1:%s" % cls.upstream.server_port
        gateway.TOKEN = "axivestra-test-token"
        cls.gateway_server = ThreadingHTTPServer(("127.0.0.1", 0), gateway.Handler)
        cls.gateway_thread = Thread(target=cls.gateway_server.serve_forever, daemon=True)
        cls.gateway_thread.start()
        cls.base_url = "http://127.0.0.1:%s" % cls.gateway_server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.gateway_server.shutdown()
        cls.gateway_server.server_close()
        cls.upstream.shutdown()
        cls.upstream.server_close()

    def request(self, path, token=None):
        headers = {}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        request = Request(self.base_url + path, headers=headers)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def test_public_health_only_checks_internal_listener(self):
        status, body = self.request("/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"ok")

    def test_readyz_rejects_missing_and_mismatched_tokens(self):
        self.assertEqual(self.request("/readyz")[0], 401)
        self.assertEqual(self.request("/readyz", "wrong-token")[0], 401)

    def test_readyz_accepts_vault_token_only_when_engine_is_reachable(self):
        status, body = self.request("/readyz", "axivestra-test-token")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"ready")

    def test_search_requires_token_and_proxies_json(self):
        gateway.request_times.clear()
        self.assertEqual(self.request("/search?q=fixture")[0], 401)
        status, body = self.request("/search?q=fixture", "axivestra-test-token")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["results"][0]["title"], "Fixture")


if __name__ == "__main__":
    unittest.main()
