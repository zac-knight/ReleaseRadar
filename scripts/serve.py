#!/usr/bin/env python3
"""Static dev server that disables browser caching, so edits show up on a normal reload."""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_env():
    """Minimal .env reader (KEY=value lines, # comments, optional quotes)."""
    env = {}
    try:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("\"'")
    except FileNotFoundError:
        pass
    return env

class NoCache(SimpleHTTPRequestHandler):
    def do_GET(self):
        # The app reads the TMDB key from .env through this endpoint (re-read on every request).
        if self.path.split("?")[0] == "/config.json":
            env = load_env()
            body = json.dumps({"tmdbKey": os.environ.get("TMDB_API_KEY") or env.get("TMDB_API_KEY", "")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

start = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
for port in range(start, start + 20):
    try:
        server = ThreadingHTTPServer(("", port), NoCache)
        break
    except OSError:
        print(f"Port {port} in use, trying {port + 1}...")
else:
    sys.exit(f"No free port in {start}-{start + 19}")
print(f"Release Radar on http://localhost:{port}/")
if not (os.environ.get("TMDB_API_KEY") or load_env().get("TMDB_API_KEY")):
    print("No TMDB_API_KEY in .env (copy .env.example to .env), you can still enter a key in Settings.")
server.serve_forever()
