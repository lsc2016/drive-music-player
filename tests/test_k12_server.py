import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from server.k12_server import Handler, music_root

class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); base = Path(cls.tmp.name)
        cls.root = base / "music"; cls.root.mkdir(); (cls.root / "album").mkdir()
        cls.data = bytes(range(100)); (cls.root / "album" / "한 곡.mp3").write_bytes(cls.data)
        (cls.root / "two.m4a").write_bytes(b"second"); (cls.root / ".hidden.mp3").write_bytes(b"hidden")
        (cls.root / "note.txt").write_bytes(b"secret content"); (base / "outside.mp3").write_bytes(b"outside secret")
        (cls.root / "link.mp3").symlink_to(base / "outside.mp3")
        Handler.root = cls.root.resolve(); cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.tmp.cleanup()
    def request(self, path, headers=None, method="GET"):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request(method, path, headers=headers or {}); res = conn.getresponse(); body = res.read(); result = (res.status, dict(res.getheaders()), body); conn.close(); return result
    def test_ranges(self):
        path = "/api/file/album/%ED%95%9C%20%EA%B3%A1.mp3"
        status, h, body = self.request(path, {"Range": "bytes=10-19"}); self.assertEqual((status, body, h["Content-Range"]), (206, self.data[10:20], "bytes 10-19/100"))
        self.assertEqual(self.request(path, {"Range": "bytes=-5"})[2], self.data[-5:])
        self.assertEqual(self.request(path, {"Range": "bytes=100-"})[0], 416)
        status, h, body = self.request(path); self.assertEqual((status, body, h["Accept-Ranges"]), (200, self.data, "bytes"))
        status, h, body = self.request(path, method="HEAD"); self.assertEqual((status, h["Content-Length"], body), (200, "100", b""))
    def test_safety_and_list(self):
        for path in ["/api/file/../outside.mp3", "/api/file/%2e%2e/outside.mp3", "/api/file/link.mp3", "/api/file/note.txt", "/.git/config", "/CLAUDE.md", "/server/k12_server.py"]:
            status, _, body = self.request(path); self.assertIn(status, (403, 404)); self.assertNotIn(b"secret", body)
        status, h, body = self.request("/api/tracks"); tracks = json.loads(body)["tracks"]
        self.assertEqual(status, 200); self.assertEqual(h["Cache-Control"], "no-store"); self.assertEqual(len(tracks), 2)
        self.assertIn(dict(id="album/한 곡.mp3", name="한 곡.mp3", size=100, mimeType="audio/mpeg", folderName="album"), tracks)
        self.assertIn(dict(id="two.m4a", name="two.m4a", size=6, mimeType="audio/mp4", folderName=""), tracks)
    def test_shell_and_config(self):
        for path in ("/", "/index.html"): self.assertIn(b'name="dm-source" content="k12"', self.request(path)[2])
        self.assertNotIn(b'name="dm-source"', Path("index.html").read_bytes())
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError): music_root(Path(self.tmp.name) / "missing")
if __name__ == "__main__": unittest.main()
