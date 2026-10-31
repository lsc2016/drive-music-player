#!/usr/bin/env python3
"""상단 ⚙ 설정 메뉴가 코드에 제대로 들어갔는지, 로그아웃이 한 번에 안 일어나는지 확인 (브라우저 동작은 사람이 봄).
돌리기: python3 tests/check_settings_menu.py — 하나라도 빠지면 1로 끝남."""
import re
import sys
from pathlib import Path


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
    """문자열·주석·정규식 대강 빼기 (check_queue_sheet.py와 같은 방식)"""
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


ROOT = Path(__file__).resolve().parent.parent
app = (ROOT / "app.js").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")
readme = (ROOT / "README.md").read_text(encoding="utf-8")

header = re.search(r"<header>(.*?)</header>", html, re.S)
header = header.group(1) if header else ""
code = strip_code(app)   # 주석·문자열을 뺀 코드 (주석 속 "logout()" 글자는 안 셈)

menu = func_body(app, "openSettingsMenu")
confirm = func_body(app, "confirmLogout")
show = re.search(r"const show = \(screen\) => \{(.*?)\n  \};", app, re.S)
show = show.group(1) if show else ""

# logout() 을 부르는 곳: 정의(function logout()) 말고 전부
calls = [m.start() for m in re.finditer(r"(?<![\w.])logout\s*\(", code)]
defs = [m.start() + len("function ") for m in re.finditer(r"function\s+logout\s*\(", code)]
calls = [c for c in calls if c not in defs]
confirm_code = strip_code(confirm)
ok_fn = re.search(r"ok:\s*\{[^}]*fn:\s*\(\)\s*=>\s*\{?\s*logout\(\)", confirm_code)

checks = [
    ("1. header에 btn-settings가 있음", 'id="btn-settings"' in header),
    ("1. header에 btn-logout·btn-folder·btn-refresh가 없음",
     not any(f'id="{x}"' in html for x in ("btn-logout", "btn-folder", "btn-refresh"))),
    ("2. logout을 클릭에 바로 붙인 곳 없음 (onclick = logout / addEventListener(..., logout))",
     re.search(r"onclick\s*=\s*logout\b", code) is None
     and re.search(r"addEventListener\([^)]*,\s*logout\s*\)", code) is None),
    ("2. logout()을 부르는 곳은 딱 하나, 확인 창 ok.fn 안", len(calls) == 1 and ok_fn is not None
     and "logout(" in confirm_code and code.count("logout(") - len(defs) == 1),
    ("2. 확인 창이 openMSheet에 [로그아웃] ok 버튼을 둠",
     "openMSheet(" in confirm and 'label: "로그아웃"' in confirm),
    ("2. 메뉴의 로그아웃 줄은 logout이 아니라 confirmLogout으로 감",
     "confirmLogout" in menu and "logout(" not in strip_code(menu).replace("confirmLogout", "")),
    ("3. 설정 메뉴 함수 openSettingsMenu가 있음", bool(menu)),
    ("3. 메뉴에 openMSheet·showFolderPicker·retagAll·openFolder 호출",
     all(x + "(" in menu for x in ("openMSheet", "showFolderPicker", "retagAll", "openFolder"))),
    ("3. 메뉴 순서: 폴더 바꾸기 → 새로고침 → 태그 전부 다시 읽기 → 로그아웃",
     0 <= menu.find('"폴더 바꾸기"') < menu.find('"새로고침"') < menu.find('"태그 전부 다시 읽기"') < menu.find('"로그아웃"')),
    ("3. 새로고침 두 줄은 곡 목록 화면 + state.folder 아닐 때 흐리게(off)",
     "el.sTracks" in menu and "state.folder" in menu and menu.count("!onTracks") == 2),
    ("3. 로그아웃 줄은 빨간 글씨(danger)", re.search(r'menuRow\("로그아웃"[^;]*true\)\)', menu) is not None
     and "#msheet .row.danger" in html),
    ("4. btnSettings에 메뉴 함수가 연결됨", re.search(r"el\.btnSettings\.onclick\s*=\s*openSettingsMenu\b", app) is not None
     and 'btnSettings: $("btn-settings")' in app),
    ("5. show()가 로그인 화면·하위 화면에서 btnSettings를 숨김",
     'el.btnSettings.classList.toggle("hidden", !signedIn || sub)' in show
     and "screen !== el.sLogin" in show and "el.sPl" in show and "el.sTags" in show),
    ("6. app.js에 refreshTimer·btnLogout·btnRefresh·btnFolder가 없음",
     not any(re.search(r"\b" + x + r"\b", app) for x in ("refreshTimer", "refreshLong", "btnLogout", "btnRefresh", "btnFolder"))),
    ("6. index.html에 #btn-refresh 전용 CSS가 없음", "#btn-refresh" not in html),
    ("7. app.js 괄호 {} () [] 짝이 맞음", brackets_ok(app)),
    ("8. README에 '길게 누르' 새로고침 안내가 없음",
     not any("길게 누르" in ln and "새로고침" in ln for ln in readme.splitlines())),
    ("8. README에 로그아웃은 ⚙ 안에서 한 번 더 물어본다는 안내", any("로그아웃" in ln and "⚙" in ln and "물어" in ln for ln in readme.splitlines())),
    ("보관함 ⋯ 메뉴 글씨가 '설정(⚙) 메뉴에도 있어요'로 바뀜",
     "설정(⚙) 메뉴에도 있어요" in func_body(app, "openLibMenu") and "새로고침 아이콘 길게" not in app),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
sys.exit(1 if fail else 0)
