import hmac
import os
import socket
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

TOKEN = os.environ.get("AXIVESTRA_SEARCH_TOKEN", "")
PORT = int(os.environ.get("PORT", "10000"))
UPSTREAM = "http://127.0.0.1:8080"
WINDOW_SECONDS = 60
MAX_REQUESTS_PER_WINDOW = 300
request_times = deque()

class Handler(BaseHTTPRequestHandler):
    server_version = "AXIVESTRA-Search-Gateway"

    def log_message(self, fmt, *args):
        # Do not log search terms or Authorization headers.
        return

    def respond(self, status, body, content_type="text/plain; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path in ("/", "/healthz"):
            # A homepage GET is subject to SearXNG bot detection and may be
            # rejected when this internal probe has no real client IP headers.
            # Check the local listener instead; authenticated /search requests
            # still exercise the full upstream search path.
            try:
                with socket.create_connection(("127.0.0.1", 8080), timeout=2):
                    self.respond(200, "ok")
                    return
            except OSError:
                self.respond(503, "search engine starting")
                return

        if parsed.path != "/search":
            self.respond(404, "not found")
            return
        if not TOKEN:
            self.respond(503, "search gateway token is not configured")
            return
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, "Bearer " + TOKEN):
            self.respond(401, "unauthorized")
            return

        now = time.monotonic()
        while request_times and now - request_times[0] > WINDOW_SECONDS:
            request_times.popleft()
        if len(request_times) >= MAX_REQUESTS_PER_WINDOW:
            self.respond(429, "rate limit exceeded")
            return

        params = parse_qs(parsed.query, keep_blank_values=False)
        query = (params.get("q") or [""])[0].strip()
        if not query or len(query) > 500:
            self.respond(400, "invalid query")
            return
        language = (params.get("language") or ["en"])[0][:12]
        safe = (params.get("safesearch") or ["2"])[0]
        if safe not in ("1", "2"):
            safe = "2"
        forward = urlencode({
            "q": query,
            "format": "json",
            "language": language,
            "safesearch": safe,
            "pageno": "1"
        })
        try:
            request_times.append(now)
            forwarded_for = self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]
            req = Request(UPSTREAM + "/search?" + forward, headers={
                "Accept": "application/json",
                "X-Forwarded-For": forwarded_for,
                "X-Real-IP": forwarded_for
            })
            with urlopen(req, timeout=12) as response:
                payload = response.read(2_000_000)
                if len(payload) >= 2_000_000:
                    self.respond(502, "search response too large")
                    return
                self.respond(response.status, payload, response.headers.get("Content-Type", "application/json"))
        except HTTPError as error:
            self.respond(error.code, error.read(4096), error.headers.get("Content-Type", "text/plain"))
        except (URLError, TimeoutError, OSError) as error:
            self.respond(502, "upstream search unavailable")

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
