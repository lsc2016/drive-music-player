"""Local, read-only music server for the k12 edition."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
TYPES = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "flac": "audio/flac", "wav": "audio/wav", "ogg": "audio/ogg", "aac": "audio/aac", "opus": "audio/ogg", "wma": "audio/x-ms-wma", "aiff": "audio/aiff"}

def music_root(paths_file=None):
    value = os.environ.get("MUSIC_ROOT")
    if not value:
        path = Path(paths_file) if paths_file else Path.home() / ".config/board/paths.env"
        try:
            for line in path.read_text().splitlines():
                key, sep, val = line.partition("=")
                if sep and key.strip() == "MUSIC_ROOT":
                    value = val.strip().strip("\"'")
                    break
        except FileNotFoundError:
            pass
    if not value or not Path(value).is_dir():
        raise ValueError("MUSIC_ROOT가 없거나 음악 폴더가 존재하지 않습니다")
    return Path(value).resolve()

DATA_FILES = {"playlists": "drive-music-playlists.md", "library": "drive-music-library.md"}
DATA_LOCK = threading.Lock()
MAX_DATA = 10 * 1024 * 1024

def read_data(root, name):
    if name not in DATA_FILES: return 404, b"", None
    path = root / ".드라이브뮤직" / DATA_FILES[name]
    try:
        with path.open("rb") as f:
            body = f.read()
            version = str(os.fstat(f.fileno()).st_mtime_ns)
        return 200, body, version
    except FileNotFoundError:
        return 200, b"", "none"

def write_data(root, name, body, match):
    if name not in DATA_FILES: return 404, b"", None
    if match is None: return 428, b"", None
    if len(body) > MAX_DATA: return 413, b"", None
    try: body.decode("utf-8")
    except UnicodeDecodeError: return 400, b"", None
    with DATA_LOCK:
        _, current, version = read_data(root, name)
        if match != version: return 409, current, version
        directory = root / ".드라이브뮤직"
        directory.mkdir(exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=directory, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as f: f.write(body)
            os.replace(temp, directory / DATA_FILES[name])
        finally:
            if os.path.exists(temp): os.unlink(temp)
        return read_data(root, name)

class Handler(BaseHTTPRequestHandler):
    root = None
    def reply(self, status, body=b"", mime="text/plain; charset=utf-8", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        if urlsplit(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items(): self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)
    def do_HEAD(self): self.do_GET()
    def do_PUT(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/data/"): return self.reply(404)
        name = path[len("/api/data/"):]
        if name not in DATA_FILES: return self.reply(404)
        if self.headers.get("If-Match") is None: return self.reply(428)
        try: length = int(self.headers.get("Content-Length", "-1"))
        except ValueError: return self.reply(400)
        if length < 0: return self.reply(400)
        if length > MAX_DATA: return self.reply(413)
        body = self.rfile.read(length)
        if len(body) != length: return self.reply(400)
        status, content, version = write_data(self.root, name, body, self.headers.get("If-Match"))
        self.reply(status, content, extra={"ETag": version} if version else None)
    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/data/"):
            status, body, version = read_data(self.root, path[len("/api/data/"):])
            return self.reply(status, body, extra={"ETag": version} if version else None)
        if path == "/api/tracks":
            tracks = []
            for p in sorted(self.root.rglob("*")):
                rel = p.relative_to(self.root)
                if any(part.startswith(".") for part in rel.parts) or p.suffix.lower().lstrip(".") not in TYPES: continue
                try:
                    if not p.is_file() or not p.resolve().is_relative_to(self.root): continue
                    tracks.append(dict(id=rel.as_posix(), name=p.name, size=p.stat().st_size, mimeType=TYPES[p.suffix.lower()[1:]], folderName=rel.parent.name if len(rel.parts) > 1 else ""))
                except OSError: continue
            return self.reply(200, json.dumps({"tracks": tracks}, ensure_ascii=False).encode(), "application/json; charset=utf-8")
        if path.startswith("/api/file/"):
            ident = unquote(path[len("/api/file/"):])
            parts = ident.split("/")
            p = (self.root / ident).resolve()
            if not ident or ident.startswith("/") or any(x in ("", ".", "..") or x.startswith(".") for x in parts) or not p.is_relative_to(self.root) or p.suffix.lower().lstrip(".") not in TYPES or not p.is_file(): return self.reply(404)
            size = p.stat().st_size
            start, end, status = 0, size - 1, 200
            header = self.headers.get("Range", "")
            if header and "," not in header:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
                if not match or not any(match.groups()): return self.reply(416, extra={"Content-Range": f"bytes */{size}"})
                a, b = match.groups()
                if not a:
                    n = int(b); start = max(0, size - n); end = size - 1
                    if not n: start = size
                else:
                    start = int(a); end = min(int(b), size - 1) if b else size - 1
                if start >= size or end < start: return self.reply(416, extra={"Content-Range": f"bytes */{size}"})
                status = 206
            self.send_response(status)
            self.send_header("Content-Type", TYPES[p.suffix.lower()[1:]])
            self.send_header("Cache-Control", "no-store")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(max(0, end-start+1)))
            if status == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command != "HEAD":
                with p.open("rb") as f:
                    f.seek(start); remaining = end-start+1
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk: break
                        self.wfile.write(chunk); remaining -= len(chunk)
            return
        allowed = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/config.js": "config.js", "/manifest.json": "manifest.json", "/sw.js": "sw.js"}
        name = allowed.get(path)
        if not name and re.fullmatch(r"/icons/[A-Za-z0-9_-]+\.png", path): name = path[1:]
        if not name: return self.reply(404)
        p = (ROOT / name).resolve()
        if not p.is_relative_to(ROOT) or not p.is_file(): return self.reply(404)
        body = p.read_bytes()
        if name == "index.html": body = body.replace(b"<head>", b'<head>\n<meta name="dm-source" content="k12">', 1)
        mime = {".html": "text/html; charset=utf-8", ".js": "application/javascript", ".json": "application/json", ".png": "image/png"}[p.suffix]
        self.reply(200, body, mime)

def main():
    try:
        Handler.root = music_root()
        host = os.environ.get("HOST", "127.0.0.1"); port = int(os.environ.get("PORT", "8520"))
        server = ThreadingHTTPServer((host, port), Handler)
    except (ValueError, OSError) as e:
        print(f"오류: {e}", file=sys.stderr); return 1
    print(f"음악 폴더: {Handler.root} · 주소: {host} · 포트: {port} (운영은 HOST=100.108.33.65 또는 serve 대상을 127.0.0.1로)", flush=True)
    server.serve_forever()
    return 0
if __name__ == "__main__": sys.exit(main())
