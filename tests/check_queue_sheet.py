#!/usr/bin/env python3
"""다음 곡 시트가 코드에 제대로 들어갔는지 대강 확인 (브라우저 동작은 사람이 봄).
돌리기: python3 tests/check_queue_sheet.py — 하나라도 빠지면 1로 끝남."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
app = (ROOT / "app.js").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")


def func_body(src, name):
    """function name(...) { ... } 의 몸통 (괄호 짝으로 끝을 찾음)"""
    m = re.search(r"function\s+" + name + r"\s*\([^)]*\)\s*\{", src)
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


def strip_code(src):
    """문자열·주석·정규식 대강 빼기 (괄호 세기용)"""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if two == "/*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "\"'`":
            q, i = c, i + 1
            while i < n and src[i] != q:
                if src[i] == "\\":
                    i += 1
                elif q == "`" and src[i:i + 2] == "${":
                    # 템플릿 안 ${ ... }: 짝 맞춰 건너뜀
                    d, i = 1, i + 2
                    while i < n and d:
                        if src[i] == "{":
                            d += 1
                        elif src[i] == "}":
                            d -= 1
                        i += 1
                    continue
                i += 1
            i += 1
            continue
        if c == "/":
            # 앞 글자로 정규식인지 짐작: ( , = : [ ! & | ? { } ; 또는 줄 시작 뒤면 정규식
            k = len(out) - 1
            while k >= 0 and out[k] in " \t":
                k -= 1
            prev = out[k] if k >= 0 else "\n"
            if prev in "(,=:[!&|?{};\n" or "".join(out[-6:]).endswith("return"):
                i += 1
                in_class = False
                while i < n and (src[i] != "/" or in_class) and src[i] != "\n":
                    if src[i] == "\\":
                        i += 1
                    elif src[i] == "[":
                        in_class = True
                    elif src[i] == "]":
                        in_class = False
                    i += 1
                i += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def brackets_ok(src):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for c in strip_code(src):
        if c in "([{":
            stack.append(c)
        elif c in pairs:
            if not stack or stack[-1] != pairs[c]:
                return False
            stack.pop()
    return not stack


open_body = func_body(app, "openQueueSheet")
content_body = func_body(app, "queueSheetContent")
render_body = func_body(app, "renderQueueSheet")
sheet_code = open_body + content_body + render_body
play_paths = func_body(app, "showNowPlaying") + func_body(app, "showNowPlayingText") + func_body(app, "playCurrent")

checks = [
    ("시트를 여는 함수 openQueueSheet가 있음", bool(open_body)),
    ("다시 그리는 함수 renderQueueSheet가 있음", bool(render_body)),
    ("여는 함수가 openMSheet(#msheet)를 씀", "openMSheet(" in open_body),
    ("곡이 없으면 안 엶 (currentTrack 확인)", "currentTrack()" in open_body),
    ("순서를 state.order와 state.pos로 만듦", "state.order" in sheet_code and "state.pos + 1" in sheet_code),
    ("줄을 누르면 state.pos를 바꾸고 playCurrent를 부름",
     re.search(r"state\.pos\s*=\s*p\s*;\s*playCurrent\(\)", content_body) is not None),
    ("repeat 'all'이면 처음으로 돌아가 이어 붙임",
     re.search(r'state\.repeat\s*===\s*"all"\)\s*for\s*\(let p = 0; p < state\.pos', content_body) is not None
     and "처음부터 다시" in content_body),
    ("한 곡 반복이면 부제에 알림", "한 곡 반복 중" in content_body),
    ("마지막 곡 안내", "마지막 곡이에요" in content_body),
    ("100곡까지만 그리고 '외 N곡'", "QUEUE_MAX = 100" in app and "외 ${" in content_body),
    ("곡이 바뀔 때 다시 그리는 호출 (showNowPlaying 쪽)", "renderQueueSheet()" in play_paths),
    ("열림 상태 state.queueOpen을 openMSheet·closeMSheet가 끔",
     "state.queueOpen = false" in func_body(app, "openMSheet") and "state.queueOpen = false" in func_body(app, "closeMSheet")),
    (".meta와 #np-art에 누르기 연결",
     re.search(r'querySelector\("\.np \.meta"\)\.addEventListener\("click",\s*openQueueSheet\)', app) is not None
     and re.search(r'el\.npArt\.addEventListener\("click",\s*openQueueSheet\)', app) is not None),
    ("♥ 버튼은 .meta 밖에 있음 (눌러도 시트 안 열림)",
     re.search(r'<div class="meta">(?:(?!</div>\s*</div>).)*btn-fav', html, re.S) is None and 'id="btn-fav"' in html),
    ("♥ 버튼에 시트 여는 연결 없음", re.search(r"btnFav[^;\n]*openQueueSheet", app) is None),
    ("index.html: 누를 수 있다는 표시와 구분 글 스타일", ".np .meta, .np .art { cursor: pointer" in html and "#msheet .qnote" in html),
    ("app.js 괄호 {} () [] 짝이 맞음", brackets_ok(app)),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
sys.exit(1 if fail else 0)
