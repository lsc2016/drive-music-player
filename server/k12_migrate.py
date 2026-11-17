"""Preview or migrate Drive markdown into k12 storage."""
import argparse
import json
import re
import sys
from pathlib import Path
from k12_server import music_root, read_data, write_data

LANGS = ("한국어", "중국어", "영어", "일본어", "기타", "")

def parse_playlists(text):
    out = {}; current = None
    for line in text.splitlines():
        h = re.match(r"^##\s+(.+?)\s*$", line)
        if h:
            current = out.setdefault(h.group(1), [])
        elif current is not None:
            m = re.match(r"^-\s+(.*?)\s*\|\s*([^|]+?)\s*(?:\|\s*(.*))?$", line)
            if m: current.append((m.group(1), m.group(2).strip(), (m.group(3) or "").strip()))
    return out

def serialize_playlists(data):
    lines = ["# Drive Music 플레이리스트", ""]
    for name, items in data.items():
        lines += ["## " + name, ""] + [f"- {title} | {ident} | {folder}" for title, ident, folder in items] + [""]
    return "\n".join(lines)

def parse_library(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r"^-\s+([^|]+?)\s*\|(.*)$", line)
        if not m: continue
        cells = [x.strip() for x in m.group(2).split("|")]
        if len(cells) < 9: continue
        edited = len(cells) >= 10 and cells[-1] == "edited"
        if edited: cells.pop()
        language = cells.pop() if len(cells) >= 10 and cells[-1] in LANGS else ""
        out[m.group(1).strip()] = (cells[:8] + ["|".join(cells[8:]), language], edited)
    return out

def serialize_library(data):
    lines = ["# Drive Music 보관함", ""]
    for ident, (cells, edited) in data.items():
        lines.append("- " + " | ".join([ident] + [x.replace("|", "∣") for x in cells] + (["edited"] if edited else [])))
    return "\n".join(lines + [""])

def migrate(root, execute=False):
    mapping = root / ".드라이브ID대응.json"
    source = root / ".드라이브사본"
    pl = source / "drive-music-playlists.md"; lib = source / "drive-music-library.md"
    if not all(p.is_file() for p in (mapping, pl, lib)):
        print("대응표가 아직 없어요(구글 로그인 뒤 운영이 만들어요)"); return 1
    files = json.loads(mapping.read_text(encoding="utf-8"))["files"]
    def path(ident):
        item = files.get(ident, {})
        value = item.get("path") if item.get("ok") else None
        return value if isinstance(value, str) and value and "|" not in value else None
    _, oldpl, pv = read_data(root, "playlists"); _, oldlib, lv = read_data(root, "library")
    playlists = parse_playlists(oldpl.decode()); library = parse_library(oldlib.decode())
    missing = {}; edited_missing = []; other = 0; moved = 0
    for name, items in parse_playlists(pl.read_text(encoding="utf-8")).items():
        dest = playlists.setdefault(name, [])
        for title, ident, folder in items:
            new = path(ident)
            if not new: missing.setdefault(name, []).append(title); continue
            if not any(x[1] == new for x in dest): dest.append((title, new, folder)); moved += 1
    incoming = {}
    for ident, row in parse_library(lib.read_text(encoding="utf-8")).items():
        new = path(ident)
        if not new:
            if row[1]: edited_missing.append(row[0][0] or ident)
            else: other += 1
            continue
        if new not in incoming or (row[1] and not incoming[new][1]): incoming[new] = row
    for ident, row in incoming.items():
        if ident not in library or not library[ident][1]: library[ident] = row; moved += 1
    report = ["# 옮기기 짝없음", "", "## 플레이리스트"]
    for name, titles in missing.items(): report += ["### " + name] + ["- " + t for t in titles]
    report += ["", "## 고친 태그"] + ["- " + t for t in edited_missing] + ["", f"## 그 밖 개수: {other}", ""]
    print(f"옮김 {moved} · 짝없음 {sum(map(len, missing.values())) + len(edited_missing) + other}")
    print("\n".join(report))
    if execute:
        for name, body, version in (("playlists", serialize_playlists(playlists), pv), ("library", serialize_library(library), lv)):
            status, _, _ = write_data(root, name, body.encode(), version)
            if status != 200: print(f"{name} 저장 실패: {status} — 다시 미리보기 해 주세요", file=sys.stderr); return 1
        (root / ".드라이브뮤직" / "옮기기-짝없음.md").write_text("\n".join(report), encoding="utf-8")
    return 0

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--do", action="store_true"); args = parser.parse_args()
    try: return migrate(music_root(), args.do)
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as e:
        print(f"오류: {e}", file=sys.stderr); return 1
if __name__ == "__main__": sys.exit(main())
