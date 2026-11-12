#!/usr/bin/env python3
"""길 잃지 않기(~/board/원칙.md) 확인: 로고 → 첫 화면, 하위 화면의 ← 뒤로 = 브라우저 뒤로가기(주소 #표시),
바텀시트 ✕·Esc. 이 환경엔 브라우저가 없어 index.html·app.js 글을 함수 몸통 단위로 훑음 (눌러 보는 건 사람 몫).
돌리기: python3 tests/check_wayfinding.py — 하나라도 빠지면 1로 끝남."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
app = (ROOT / "app.js").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")


def block_after(src, pattern):
    """pattern 이 '{' 로 끝나는 곳부터 짝 맞는 '}' 까지의 몸통"""
    m = re.search(pattern, src)
    if not m:
        return ""
    depth, i = 0, m.end() - 1
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[m.end():i]
        i += 1
    return ""


def func_body(src, name):
    return block_after(src, r"function\s+" + name + r"\s*\([^)]*\)\s*\{")


def tag_block(src, tag_id):
    """id 가 tag_id 인 <div ...> 의 안쪽 (div 짝을 세어 끝을 찾음)"""
    m = re.search(r'<div id="' + tag_id + r'"[^>]*>', src)
    if not m:
        return ""
    depth, i = 1, m.end()
    for t in re.finditer(r"<(/?)div\b", src[m.end():]):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return src[m.end():m.end() + t.start()]
    return ""


show = block_after(app, r"const show = \(screen\) => \{")
sync = func_body(app, "syncHash")
home = func_body(app, "goHome")
back2 = func_body(app, "backToTracks")
pop = block_after(app, r'window\.addEventListener\("popstate",\s*\(\)\s*=>\s*\{')
back_click = block_after(app, r"el\.btnBack\.onclick\s*=\s*\(\)\s*=>\s*\{")
esc = block_after(app, r'document\.addEventListener\("keydown",\s*\(e\)\s*=>\s*\{\s*if \(e\.key !== "Escape"\) return;')
init = func_body(app, "init")
header = re.search(r"<header>(.*?)</header>", html, re.S)
header = header.group(1) if header else ""
sheet = tag_block(html, "sheet")
msheet = tag_block(html, "msheet")
screen_hash = re.search(r"SCREEN_HASH = new Map\(\[(.*?)\]\);", app)
screen_hash = screen_hash.group(1) if screen_hash else ""

checks = [
    # 1. 로고
    ("1. header 안에 로고 #btn-home (앱 이름 Drive Music), 화면(section)들은 header 밖이라 늘 보임",
     'id="btn-home"' in header and "Drive Music" in header and "<section" not in header),
    ("1. 로고를 숨기는 코드 없음", re.search(r"btnHome\.classList\.(toggle|add)\(\"hidden\"", app) is None),
    ("1. el.btnHome.onclick = goHome, goHome 이 플레이리스트·태그 편집·폴더 고르기에서 곡 목록으로",
     re.search(r"el\.btnHome\.onclick\s*=\s*goHome\b", app) is not None
     and all(x in home for x in ("closePlaylist()", "closeTagEditor()", "backToTracks()"))),
    # 2. ← 뒤로
    ("2. show(): ← 는 하위 화면(#s-pl·#s-tags) + 폴더 고르기(돌아갈 폴더가 있을 때)에서 보임, 로그인·곡 목록에선 숨김",
     'el.btnBack.classList.toggle("hidden", !(sub || (screen === el.sFolder && state.folder)))' in show
     and "const sub = screen === el.sPl || screen === el.sTags" in show),
    ("2. ← 누르면: 태그 편집 → closeTagEditor, 플레이리스트 → closePlaylist, 폴더 고르기 → backToTracks",
     all(x in back_click for x in ("closeTagEditor()", "closePlaylist()", "backToTracks()"))
     and "el.sFolder" in back_click),
    ("2. backToTracks: 받아둔 목록이면 show(el.sTracks), 아니면 openFolder (goHome 의 예전 길 그대로)",
     "show(el.sTracks)" in back2 and "openFolder(state.folder)" in back2 and "state.libFor !== state.folder.id" in back2),
    ("2. 화면을 바꾸면 주소도: show() 가 syncHash(screen) 를 부름", "syncHash(screen)" in show),
    ("2. 하위 화면 주소 #folder·#pl·#tags", all(f'"{h}"' in screen_hash for h in ("#folder", "#pl", "#tags"))
     and all(s in screen_hash for s in ("el.sFolder", "el.sPl", "el.sTags"))),
    ("2. syncHash: 하위 화면으로 가면 pushState, 하위끼리는 replaceState, 첫 화면으로 오면 history.back() (skipPop++)",
     "history.pushState(" in sync and "history.replaceState(" in sync
     and re.search(r"skipPop\+\+;\s*history\.back\(\)", sync) is not None and "if (fromPop) return" in sync),
    ("2. 경로는 그대로, 해시만 (location.pathname + location.search)", "location.pathname + location.search" in app
     and re.search(r"pushState\([^)]*location\.pathname", app) is None),
    ("2. popstate(브라우저 뒤로가기) → ← 와 같은 곳 (closeTagEditor / closePlaylist / backToTracks)",
     bool(pop) and all(x in pop for x in ("closeTagEditor()", "closePlaylist()", "backToTracks()"))
     and "!location.hash" in pop),
    ("2. popstate: 우리가 부른 back 은 건너뜀(skipPop), 바꾸는 동안 fromPop 으로 주소를 다시 안 건드림",
     re.search(r"if \(skipPop > 0\) \{ skipPop--; return; \}", pop) is not None
     and "fromPop = true" in pop and re.search(r"finally \{ fromPop = false; \}", pop) is not None),
    ("2. 처음 열 때 해시가 남아 있어도 지우고 시작 (로그인 화면이 안 깨짐)",
     re.search(r"if \(location\.hash[^)]*\)\)? history\.replaceState\(null, \"\", plainUrl\(\)\)", init) is not None),
    # 3. 겹쳐 뜨는 창
    ("3. #sheet 안에 ✕ 버튼(#sheet-x)", 'id="sheet-x"' in sheet and 'title="닫기' in sheet),
    ("3. #msheet 안에 ✕ 버튼(#msheet-x)", 'id="msheet-x"' in msheet),
    ("3. ✕ 누르면 닫힘: el.sheetX.onclick = closeSheet, el.msheetX.onclick = closeMSheet",
     re.search(r"el\.sheetX\.onclick\s*=\s*closeSheet\b", app) is not None
     and re.search(r"el\.msheetX\.onclick\s*=\s*closeMSheet\b", app) is not None
     and 'sheetX: $("sheet-x")' in app and 'msheetX: $("msheet-x")' in app),
    ("3. Esc 키: 시트가 열려 있으면 closeSheet()·closeMSheet()", "closeSheet()" in esc and "closeMSheet()" in esc),
    # 받은 곡 화면 #s-dl · 오프라인 목록 (2026-11-12)
    ("1·2. #s-dl(받은 곡) 화면이 있고 header 밖(로고가 늘 보임)",
     re.search(r'<section class="screen" id="s-dl">', html) is not None and 'id="s-dl"' not in header
     and 'sDl: $("s-dl")' in app and "el.sDl" in show),
    ("2. show(): #s-dl 도 하위 화면(sub) → ← 보임, ⚙ 숨김",
     re.search(r"const sub = [^;]*screen === el\.sDl", show) is not None),
    ("2. #s-dl 주소 #dl (SCREEN_HASH)", '[el.sDl, "#dl"]' in screen_hash),
    ("2. ← 누르면 #s-dl → closeDlScreen, 브라우저 뒤로가기(popstate)도 closeDlScreen",
     re.search(r"el\.sDl\.classList\.contains\(\"show\"\)\) closeDlScreen\(\)", back_click) is not None
     and re.search(r"el\.sDl\.classList\.contains\(\"show\"\)\) closeDlScreen\(\)", pop) is not None),
    ("1. 로고: #s-dl → closeDlScreen (곡 목록·오프라인 목록으로)",
     re.search(r"el\.sDl\.classList\.contains\(\"show\"\)\) return closeDlScreen\(\)", home) is not None),
    ("2. closeDlScreen: 곡 목록(폴더 또는 오프라인 목록) → show(el.sTracks), 없으면 폴더 고르기·로그인",
     "show(el.sTracks)" in func_body(app, "closeDlScreen") and "state.offline" in func_body(app, "closeDlScreen")
     and "showFolderPicker()" in func_body(app, "closeDlScreen") and "show(el.sLogin)" in func_body(app, "closeDlScreen")),
    ("1. 오프라인 목록(state.folder 없음)에서 로고 → 그 목록 맨 위 (폴더 없다고 막히지 않음)",
     0 <= home.find('el.sTracks.classList.contains("show")) { mainEl.scrollTop = 0; return; }') < home.find("!state.folder")
     and "!state.offline" in home),
    ("1·2. 오프라인 목록은 #s-tracks 그대로 (첫 화면, 해시 없음 → 뒤로가기로 앱을 떠나지 않게 하위 화면만 해시)",
     "show(el.sTracks)" in func_body(app, "startOffline") and "[el.sTracks," not in screen_hash),
    ("3. 바깥 누르기(el.dim)는 그대로", re.search(r"el\.dim\.onclick = \(\) => \{ closeSheet\(\); closeMSheet\(\); \}", app) is not None),
    ("3. ✕ 자리 CSS (.sheet-x 오른쪽 위)", re.search(r"\.sheet-x \{[^}]*position: absolute;[^}]*right:", html) is not None),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
print("※ 모든 화면(로그인·폴더 고르기·곡 목록·플레이리스트·태그 목록 편집·받은 곡·오프라인 목록)에서 실제로 눌러 보는 건 사람 몫")
sys.exit(1 if fail else 0)
