#!/usr/bin/env python3
"""재생이 '열쇠 다툼에 걸려 영원히 기다리지 않는지', '새로고침해도 듣던 곡 주소가 안 지워지는지'를
함수 몸통 단위로 확인 (이 환경엔 node·브라우저가 없어 글을 훑음. 실제 소리는 사람이 폰에서 봄).
돌리기: python3 tests/check_playback.py — 하나라도 빠지면 1로 끝남."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def block_after(src, pattern):
    """pattern 이 '{' 로 끝나는 곳부터 짝 맞는 '}' 까지의 몸통 (괄호 짝으로 끝을 찾음)"""
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
    """function name(...) { ... } 의 몸통"""
    return block_after(src, r"function\s+" + name + r"\s*\([^)]*\)\s*\{")


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


app = (ROOT / "app.js").read_text(encoding="utf-8")

req = func_body(app, "requestToken")
get = func_body(app, "getToken")
drive = func_body(app, "driveFetch")
fetch = func_body(app, "fetchTrackUrl")
trim = func_body(app, "trimBlobs")
prefetch = func_body(app, "prefetchNext")
setlib = func_body(app, "setLibrary")
refresh = func_body(app, "refreshLibrary")
play = func_body(app, "playCurrent")
toggle = func_body(app, "togglePlay")
scan = func_body(app, "scanTags")
err = block_after(app, r'el\.audio\.addEventListener\("error",\s*\(\)\s*=>\s*\{')


def before(body, needle):
    """body 안에서 needle 이 처음 나오기 전까지 (주석·문자열 뺀 코드)"""
    code = strip_code(body)
    i = code.find(needle)
    return code[:i] if i >= 0 else None


def no_await_before(body, needle):
    """needle 을 부르기 전에 await 가 없음 (누름 효력이 살아 있는 채로 구글 창까지 감)"""
    pre = before(body, needle)
    if pre is None:
        return False
    pre = re.sub(r"await\s*$", "", pre.rstrip())   # 'await needle(' 의 await 자체는 괜찮음
    return re.search(r"\bawait\b", pre) is None


req_code = strip_code(req)
checks = [
    # (a) 열쇠 받기를 한 줄로 + 기다림 한도
    ("a. requestToken: 받는 중이면(tokenWait) 새 약속을 만들지 않고 같은 약속을 돌려줌",
     re.search(r"if\s*\(tokenWait\)\s*\{(?:(?!new Promise).)*?return tokenWait;", req_code, re.S) is not None
     and req_code.find("return tokenWait") < req_code.find("new Promise")),
    ("a. requestToken: 만든 약속을 tokenWait 에 두고, 끝나면(성공·실패 둘 다) 비움",
     "tokenWait = p" in req_code and re.search(r"p\.then\(clear,\s*clear\)", req_code) is not None
     and "tokenWait = null" in req_code),
    ("a. requestToken: 기다림 한도 타이머(TOKEN_TIMEOUT)가 있고, 답이 오면 타이머를 끔",
     re.search(r"setTimeout\([^;]*reject[^;]*TOKEN_TIMEOUT\)", req_code) is not None
     and req_code.count("clearTimeout(timer)") >= 2
     and re.search(r"TOKEN_TIMEOUT\s*=\s*\d+", app) is not None),
    ("a. requestToken: again 이면 받는 중이어도 구글 창을 그 자리에서 한 번 더 (답은 같은 약속)",
     re.search(r"if\s*\(again[^)]*\)[^;]*requestAccessToken", req_code) is not None),
    ("a. requestToken 안엔 await 가 없음 (requestAccessToken 까지 곧바로)", "await" not in req_code),
    ("a. getToken: 끝내 못 받으면 tokenFail 표시를 붙여 던짐", "tokenFail = true" in get and "throw err" in get),
    ("a. ▶ 길에 await 없음: togglePlay → requestToken, playCurrent → fetchTrackUrl, driveFetch → getToken, getToken → requestToken",
     no_await_before(toggle, "requestToken(") and no_await_before(play, "fetchTrackUrl(")
     and no_await_before(drive, "getToken(") and no_await_before(get, "requestToken(")
     and no_await_before(fetch, "driveFetch(")),
    ("a. togglePlay: 열쇠가 없으면 again:true 로 열쇠 요청", re.search(r"requestToken\(\"\",\s*\{\s*again:\s*true\s*\}\)", toggle) is not None
     and "tokenValid()" in toggle),
    ("a. togglePlay: 걸린 주소가 다른 곡 것이면 그 곡을 새로 받음(audioFor)",
     "state.audioFor !== cur.id" in toggle and "playCurrent()" in toggle),
    # (b) 받는 중 목록
    ("b. fetchTrackUrl: 받는 중이면 그 약속을 같이 기다림 (fetching.has → return fetching.get)",
     re.search(r"if\s*\(fetching\.has\(track\.id\)\)\s*return fetching\.get\(track\.id\)", fetch) is not None),
    ("b. fetchTrackUrl: 받기 시작할 때 fetching.set, 끝나면 finally 에서 fetching.delete",
     "fetching.set(track.id, p)" in fetch and re.search(r"finally\s*\{\s*fetching\.delete\(track\.id\)", fetch) is not None),
    ("b. prefetchNext: 받는 중인 곡은 또 받지 않음", "fetching.has(t.id)" in prefetch),
    ("b. 최근 6곡: trimBlobs 가 지금 곡·방금 받은 곡·오디오가 쓰는 주소를 건너뛰고(continue) 6곡이 될 때까지 지움",
     "BLOB_MAX = 6" in app and re.search(r"size\s*<=\s*BLOB_MAX\)\s*break", trim) is not None
     and re.search(r"cur && id === cur\.id\)[^;]*audioUses\(u\)\)\s*continue", trim) is not None
     and "keys().next()" not in fetch + trim and "trimBlobs(track.id)" in fetch),
    # (c) 듣던 곡 주소 남기기
    ("c. setLibrary: 비울 때 지금 곡(currentTrack)·오디오가 쓰는 주소는 continue 로 남김, 통째 clear() 없음",
     "currentTrack()" in setlib
     and re.search(r"\(cur && id === cur\.id\)\s*\|\|\s*audioUses\(u\)\)\s*continue;\s*URL\.revokeObjectURL", setlib) is not None
     and "blobUrls.clear()" not in setlib),
    ("c. setLibrary: 같은 폴더를 다시 열면 듣던 곡 자리(pos)를 그 곡으로 맞춤",
     re.search(r"const last = cur \|\|", setlib) is not None and "state.pos = -1" in setlib),
    ("c. refreshLibrary: 목록에서 빠져도 지금 곡은 keep, 오디오가 쓰는 주소도 안 지움",
     "keep.add(cur.id)" in refresh and "!audioUses(u)" in refresh
     and refresh.find("keep.add(cur.id)") < refresh.find("revokeObjectURL")),
    ("c. audioUses 는 el.audio.src 와 비교", re.search(r"audioUses\s*=\s*\(u\)\s*=>[^;]*el\.audio\.src\s*===\s*u", app) is not None),
    # (d) 재생 거절
    ("d. playCurrent: NotAllowedError 는 오류로 치지 않고 '▶를 눌러 재생하세요' + return (주소는 걸어 둠)",
     re.search(r'e\.name === "NotAllowedError"\)\s*\{[^}]*▶를 눌러 재생하세요[^}]*\}\s*return;', play) is not None
     and play.find("el.audio.src = url") < play.find("NotAllowedError")),
    ("d. playCurrent: 열쇠 실패면 '구글 연결이 끊겼어요 — ▶를 한 번 눌러 주세요'", "e.tokenFail ? \"구글 연결이 끊겼어요 — ▶를 한 번 눌러 주세요\"" in play),
    ("d. error: 주소가 지워졌거나 빈 주소면 한 곡에 한 번만 다시 받아 재생 (retryId)",
     "state.retryId !== t.id" in err and "state.retryId = t.id" in err and "playCurrent(at)" in err
     and "!src" in err and "state.blobUrls.get(t.id) !== src" in err),
    ("d. error: 그 밖(형식 문제)일 때만 '형식 문제' 안내 + 다음 곡",
     err.find("형식 문제") > err.find("playCurrent(at)") and "next()" in err),
    # (e) 연속 실패 한도
    ("e. 연속 실패 한도 FAIL_RUN_MAX = 3: 다다르면 next 없이 return, 안내",
     "FAIL_RUN_MAX = 3" in app
     and re.search(r"if \(state\.failRun >= FAIL_RUN_MAX\) \{(?:(?!next\(\)).)*?연달아 재생하지 못해 멈췄어요.*?return;", err, re.S) is not None
     and err.find("FAIL_RUN_MAX)") < err.find("next()")),
    ("e. 재생되면·손으로 ▶ 누르면 연속 실패 수를 0으로", "state.failRun = 0" in play and "state.failRun = 0" in toggle),
    # (f) 태그 읽기 쉬기
    ("f. scanTags: 열쇠 실패(tokenFail)면 tokenStop, 일꾼 반복 조건에 !tokenStop",
     re.search(r"if \(e && e\.tokenFail\) \{ tokenStop = true; return; \}", scan) is not None
     and re.search(r"while \([^)]*!tokenStop\)", scan) is not None),
    ("f. scanTags: 쉬면 드라이브 저장(flushLibrary)을 안 부르고 화면에 '태그 읽기 쉼' 표시",
     re.search(r"if \(tokenStop\) \{(?:(?!flushLibrary).)*태그 읽기 쉼(?:(?!flushLibrary).)*return;", scan, re.S) is not None),
    # (g) 빙글이
    ("g. playCurrent: finally 에서 #np-loading 을 끔 (실패해도)",
     re.search(r"finally\s*\{\s*if \(state\.loadingId === t\.id\) el\.npLoading\.classList\.add\(\"hidden\"\)", play) is not None),
    ("이름·부르는 곳 그대로: playCurrent·togglePlay·fetchTrackUrl",
     all(func_body(app, n) for n in ("playCurrent", "togglePlay", "fetchTrackUrl"))
     and "el.btnPlay.onclick = togglePlay" in app),
    ("app.js 괄호 {} () [] 짝이 맞음", brackets_ok(app)),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
sys.exit(1 if fail else 0)
