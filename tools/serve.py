#!/usr/bin/env python3
"""Dev server with Cache-Control: no-store so Chrome never serves stale assets."""
import http.server
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silence per-request noise


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    # A browser can keep an asset connection open while live-reloading.  The
    # single-threaded HTTPServer then stops answering every other request,
    # which looks exactly like a frozen game from a remote machine.
    with http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
        httpd.daemon_threads = True
        print(f"Serving {REPO} on port {port} (no-cache)")
        httpd.serve_forever()
