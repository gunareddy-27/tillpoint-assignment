"""Run the API + React frontend: python server.py [db-file] [port]

What was added (no original code changed):
- The server now also serves the built React frontend from frontend/dist/.
- Any request whose path starts with /orders, /products, /webhooks, or /reports
  is handled by the existing App.handle() (the Python API).
- Everything else (/, /index.html, /assets/*, etc.) is served as a static file
  from frontend/dist/.
- If the static file is not found, index.html is returned so React's client-side
  router can take over (single-page-app pattern).
"""
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

from tillpoint import db
from tillpoint.api import App, dumps

# Directory that contains the built React app (npm run build output)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")

# URL prefixes that belong to the Python API
API_PREFIXES = ("/orders", "/products", "/webhooks", "/reports")


def _serve_static(handler, path):
    """Serve a file from STATIC_DIR. Falls back to index.html (SPA routing)."""
    # Strip query string
    path = path.split("?")[0].split("#")[0]
    # Map / → /index.html
    if path == "/":
        path = "/index.html"
    local = os.path.join(STATIC_DIR, path.lstrip("/"))
    # Fallback to index.html for unknown paths (React Router)
    if not os.path.isfile(local):
        local = os.path.join(STATIC_DIR, "index.html")
    if not os.path.isfile(local):
        handler.send_response(404)
        handler.end_headers()
        handler.wfile.write(b"Not found")
        return
    mime, _ = mimetypes.guess_type(local)
    mime = mime or "application/octet-stream"
    with open(local, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def _serve(self):
            is_api = any(self.path.startswith(p) for p in API_PREFIXES)
            if is_api:
                # --- original API handling (unchanged) ---
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                status, payload = app.handle(self.command, self.path, body)
                data = dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                # --- serve React static files ---
                _serve_static(self, self.path)

        do_GET = do_POST = do_PUT = _serve

        def log_message(self, fmt, *args):  # silence request noise in terminal
            pass

    return Handler


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "tillpoint.db"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    has_ui = os.path.isdir(STATIC_DIR)
    print(f"Tillpoint server starting on http://127.0.0.1:{port}")
    if has_ui:
        print(f"  React UI : http://127.0.0.1:{port}/")
    else:
        print("  React UI : NOT BUILT — run 'cd frontend && npm run build' first")
    print(f"  API      : http://127.0.0.1:{port}/orders  (and /products, /webhooks, /reports)")
    HTTPServer(("127.0.0.1", port), make_handler(App(db.connect(path)))).serve_forever()
