#!/usr/bin/env python3
"""Dev server with Cache-Control: no-store so Chrome never serves stale assets."""
import http.server
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silence per-request noise


if __name__ == "__main__":
    with http.server.HTTPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"Serving {REPO} on port {PORT} (no-cache)")
        httpd.serve_forever()
