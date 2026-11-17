import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from k12_migrate import migrate, parse_library, parse_playlists

class MigrationTest(unittest.TestCase):
    def test_migration(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); src = root / ".드라이브사본"; src.mkdir()
            (root / ".드라이브ID대응.json").write_text(json.dumps({"files": {"good": {"path": "앨범/한 곡.mp3", "ok": True}, "bad": {"path": "x", "ok": False}}}))
            (src / "drive-music-playlists.md").write_text("## 즐겨찾기\n- 노래 | good | 앨범\n- 빠짐 | bad | \n- 없음 | missing | \n")
            (src / "drive-music-library.md").write_text("- good | 제목 | 가수 | 앨범 |  |  |  | 1 | 2020 | 폴더 | 한국어 | edited\n- bad | 빠짐 | 가수 |  |  |  |  |  |  |  | edited\n")
            self.assertEqual(migrate(root), 0); self.assertFalse((root / ".드라이브뮤직").exists())
            self.assertEqual(migrate(root, True), 0)
            out = root / ".드라이브뮤직"
            self.assertEqual(parse_playlists((out / "drive-music-playlists.md").read_text())["즐겨찾기"][0][1], "앨범/한 곡.mp3")
            row = parse_library((out / "drive-music-library.md").read_text())["앨범/한 곡.mp3"]
            self.assertEqual((row[0][0], row[1]), ("제목", True))
            report = (out / "옮기기-짝없음.md").read_text(); self.assertIn("빠짐", report); self.assertIn("없음", report)
            self.assertEqual(migrate(root, True), 0)
            self.assertEqual(len(parse_playlists((out / "drive-music-playlists.md").read_text())["즐겨찾기"]), 1)
    def test_missing(self):
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertNotEqual(migrate(Path(d)), 0); self.assertIn("대응표가 아직 없어요", out.getvalue())
