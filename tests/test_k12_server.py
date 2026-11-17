import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from server.k12_server import Handler, music_root, read_data, write_data

class DataTest(unittest.TestCase):
    def test_written_data_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.assertEqual(write_data(root, "library", b"data", "none")[0], 200)
            self.assertEqual((root / ".드라이브뮤직" / "drive-music-library.md").stat().st_mode & 0o777, 0o664)

    def test_versions_and_atomic_write(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.assertEqual(read_data(root, "playlists"), (200, b"", "none"))
            self.assertEqual(write_data(root, "playlists", b"one", None)[0], 428)
            self.assertEqual(write_data(root, "unknown", b"", "none")[0], 404)
            status, _, v1 = write_data(root, "playlists", b"one", "none")
            self.assertEqual(status, 200)
            status, _, v2 = write_data(root, "playlists", b"two", v1)
            self.assertEqual(status, 200); self.assertNotEqual(v1, v2)
            self.assertEqual(write_data(root, "playlists", b"lost", v1), (409, b"two", v2))
            self.assertEqual(read_data(root, "playlists")[1], b"two")
            self.assertEqual(write_data(root, "library", b"\xff", "none")[0], 400)

class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); base = Path(cls.tmp.name)
        cls.root = base / "music"; cls.root.mkdir(); (cls.root / "album").mkdir()
        cls.data = bytes(range(100)); (cls.root / "album" / "한 곡.mp3").write_bytes(cls.data)
        (cls.root / "two.m4a").write_bytes(b"second"); (cls.root / ".hidden.mp3").write_bytes(b"hidden")
        (cls.root / "note.txt").write_bytes(b"secret content"); (base / "outside.mp3").write_bytes(b"outside secret")
        (cls.root / "link.mp3").symlink_to(base / "outside.mp3")
        Handler.root = cls.root.resolve()
        try: cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        except PermissionError: cls.tmp.cleanup(); raise unittest.SkipTest("샌드박스 소켓 제한")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.tmp.cleanup()
    def request(self, path, headers=None, method="GET", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request(method, path, body=body, headers=headers or {}); res = conn.getresponse(); body = res.read(); result = (res.status, dict(res.getheaders()), body); conn.close(); return result
    def test_data_http(self):
        path = "/api/data/library"
        status, h, body = self.request(path); self.assertEqual((status, h["ETag"], body), (200, "none", b""))
        self.assertEqual(self.request(path, method="PUT", body=b"x")[0], 428)
        self.assertEqual(self.request("/api/data/other")[0], 404)
        status, h, _ = self.request(path, {"If-Match": "none"}, "PUT", b"first")
        self.assertEqual(status, 200); old = h["ETag"]
        status, h, _ = self.request(path, {"If-Match": old}, "PUT", b"second")
        self.assertEqual(status, 200)
        status, h, body = self.request(path, {"If-Match": old}, "PUT", b"lost")
        self.assertEqual((status, body), (409, b"second"))
        self.assertEqual(self.request("/api/file/.%EB%93%9C%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%AE%A4%EC%A7%81/a.mp3")[0], 404)
        self.assertNotIn(".드라이브뮤직", self.request("/api/tracks")[2].decode())
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
        self.assertNotIn(b'<meta name="dm-source"', Path("index.html").read_bytes())
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError): music_root(Path(self.tmp.name) / "missing")
if __name__ == "__main__": unittest.main()
