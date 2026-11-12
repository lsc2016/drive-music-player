#!/usr/bin/env python3
"""받아 두기(폰에 곡을 받아 두고 인터넷 없이 틀기)를 함수 몸통 단위로 확인
(이 환경엔 node·브라우저가 없어 글을 훑음 — check_background.py 와 같은 방식. 비행기 모드·잠금 시험은 사람이 아이폰에서).
 A. 받기: 한 줄로 한 곡씩, Range 조각마다 저장소에, 이어 받기, 자리 확인이 먼저, 실패는 글로
 B. 틀기: fetchTrackUrl 첫 갈래가 받은 곡, prefetchNext·playReady 가 받은 곡을 await·fetch 없이, dlUrls 는 따로
 C. 저장소: IndexedDB 한 개·칸 두 개, dm:dl·dm:dlqueue, 못 쓰면 단추 끄고 알림
 D. 관리: ⚙ "받은 곡" 줄(persisted), #s-dl(estimate·재생/섞기·✕·전부 지우기는 확인 뒤에만)
 E. 사라짐: "받은 곡이 지워졌어요" 안내·다시 받기, 드라이브로 틀면 그렇게 표시
 F. 오프라인: sw.js(구글 요청 안 담음·상대경로 등록), 오프라인 목록, 고치기 막음
 H. 문서
돌리기: python3 tests/check_offline.py — 하나라도 빠지면 1로 끝남."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


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
    return block_after(src, r"function\s+" + name + r"\s*\((?:[^()]|\([^()]*\))*\)\s*\{")


def listener(src, target, event):
    return block_after(src, re.escape(target) + r'\.addEventListener\("' + event + r'",\s*\(\)\s*=>\s*\{')


def strip_code(src):
    """문자열·주석·정규식 대강 빼기 (check_background.py 와 같은 방식)"""
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


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:\"'`])//.*$", r"\1", src)


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


def code_before(body, needle):
    code = strip_code(body)
    i = code.find(needle)
    return code[:i] if i >= 0 else None


WAIT = re.compile(r"\bawait\b|\bfetch\b|fetchTrackUrl|driveFetch|getToken|requestToken|tagBlobOf|loadArt|fetchBytes")


def no_wait_before(body, needle):
    pre = code_before(body, needle)
    return pre is not None and WAIT.search(pre) is None


app = (ROOT / "app.js").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")
sw = (ROOT / "sw.js").read_text(encoding="utf-8")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
claude = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
app_nc = strip_comments(app)
code = strip_code(app)

fetch = func_body(app, "fetchTrackUrl")
prefetch = func_body(app, "prefetchNext")
ready = func_body(app, "playReady")
after = func_body(app, "afterStart")
toggle = func_body(app, "togglePlay")
trim = func_body(app, "trimBlobs")
setlib = func_body(app, "setLibrary")
refresh = func_body(app, "refreshLibrary")
art = func_body(app, "loadArt")
enq = func_body(app, "enqueueDl")
pump = func_body(app, "pumpDl")
fail_fn = func_body(app, "dlFail")
url_of = func_body(app, "dlUrlOf")
db = func_body(app, "dlDb")
load = func_body(app, "loadDl")
persist = func_body(app, "askPersist")
space = func_body(app, "dlSpaceLeft")
menu = func_body(app, "openSettingsMenu")
menu_sub = func_body(app, "dlMenuSub")
render_dl = func_body(app, "renderDl")
play_dl = func_body(app, "playDl")
remove = func_body(app, "dlRemove")
clear_confirm = func_body(app, "confirmDlClear")
row = func_body(app, "trackRow")
mark = func_body(app, "dlMark")
chip = func_body(app, "paintDlChip")
track_menu = func_body(app, "openTrackMenu")
group_detail = func_body(app, "renderGroupDetail")
pl_detail = func_body(app, "renderPlaylistDetail")
start_off = func_body(app, "startOffline")
go_off = func_body(app, "goOffline")
go_on = func_body(app, "goOnline")
logout = func_body(app, "logout")
confirm_logout = func_body(app, "confirmLogout")
init = block_after(app, r"\(function init\(\)\s*\{")
vis = block_after(app, r'document\.addEventListener\("visibilitychange",\s*\(\)\s*=>\s*\{')
err = listener(app, "el.audio", "error")
fetch_bytes = func_body(app, "fetchBytes")
sw_fetch = block_after(sw, r'self\.addEventListener\("fetch",\s*\(event\)\s*=>\s*\{')
s_dl = re.search(r'<section class="screen" id="s-dl">(.*?)</section>', html, re.S)
s_dl = s_dl.group(1) if s_dl else ""
s_pl = re.search(r'<section class="screen" id="s-pl">(.*?)</section>', html, re.S)
s_pl = s_pl.group(1) if s_pl else ""
playbar = re.search(r'<div class="plhead" id="lib-playbar">(.*?)</div>', html, re.S)
playbar = playbar.group(1) if playbar else ""
s_tracks = re.search(r'<section class="screen" id="s-tracks">(.*?)</section>', html, re.S)
s_tracks = s_tracks.group(1) if s_tracks else ""

# prefetchNext 의 받은 곡 갈래 몸통
pre_dl = block_after(prefetch, r"if \(isDl\(t\.id\)\)\s*\{")
prefetch_code = strip_code(prefetch)
fetch_code = strip_code(fetch).strip()
chunk = re.search(r"const DL_CHUNK = (\d+) \* 1024 \* 1024", app)
leak = re.compile(r"streamUrl|access_token|state\.token\.")   # state.token 은 "로그인했나"만 봄, 열쇠 값(.access_token)은 안 씀


def after_has(body, needle, wants, span):
    """body 에서 needle 바로 뒤 span 글자 안에 wants 가 다 있음"""
    i = body.find(needle)
    return i >= 0 and all(w in body[i:i + len(needle) + span] for w in wants)

checks = [
    # A. 받기
    ("A. 한 번에 한 곡씩: pumpDl 은 하나만 돌고(dlRunning) 줄(state.dlQueue)의 맨 앞부터",
     "if (dlRunning || !state.dlOk) return;" in pump and "const id = state.dlQueue[0]" in pump and "dlRunning = false" in pump),
    ("A. 조각 2~4MB 를 Range 로 (fetchBytes → driveFetch 의 Range 머리말, 태그 읽기와 같은 길)",
     chunk is not None and 2 <= int(chunk.group(1)) <= 4 and "fetchBytes(id, m.got, end)" in pump
     and "Range: range" in fetch_bytes and "driveFetch(" in fetch_bytes),
    ("A. 조각마다 곧바로 저장소에 (조각+받은 바이트를 한 번에, dlPutChunk) → 끊겨도 남음",
     0 <= pump.find("fetchBytes(") < pump.find("dlPutChunk(nm, bytes)")
     and re.search(r'chunks"\)\.put\(new Blob\(\[bytes\]\), \[m\.id, m\.parts - 1\]\)', app) is not None
     and 'tx.objectStore("tracks").put(m)' in func_body(app, "dlPutChunk") + app[app.find("const dlPutChunk"):app.find("const dlDeleteRecords")]),
    ("A. 이어 받기: 받은 바이트(got)부터 다시, 다음 조각 끝 = got + DL_CHUNK",
     "got: m.got + bytes.length" in pump and re.search(r"const end = m\.size \? Math\.min\(m\.got \+ DL_CHUNK, m\.size\) - 1", pump) is not None),
    ("A. 이어 받는 때: 앱 열 때(init)·online·visible·로그인 뒤",
     "pumpDl" in init and "pumpDl()" in vis and 'window.addEventListener("online", goOnline)' in app
     and "pumpDl()" in go_on and "pumpDl" in func_body(app, "afterLogin")),
    ("A. 뒤에 있는데 열쇠가 끝났으면 억지로 안 받고 쉼(글로 보임) / 인터넷 없으면 쉼",
     after_has(pump, 'if (!tokenValid() && (!state.token || document.visibilityState !== "visible")) {', ("dlLine(", "return;"), 400)
     and after_has(pump, "if (!navigator.onLine) { dlLine(", ("return; }",), 200)),
    ("A. 실패는 조용히 넘기지 않음: 진행 줄(빨강)·토스트·console.warn, 그 곡은 줄에 남김(드라이브에 없는 곡만 뺌)",
     "dlFail(m, e)" in pump and re.search(r"dlLine\([^;]*, true\)", fail_fn) is not None and "toast(" in fail_fn
     and "console.warn(" in fail_fn and "다음에 이어 받아요" in fail_fn and "QuotaExceededError" in fail_fn),
    ("A. 처음 받기를 누를 때 navigator.storage.persist() 를 부르고 결과를 기억(state.dlPersisted)",
     "navigator.storage.persist()" in persist and "state.dlPersisted = v" in persist and "askPersist()" in enq),
    ("A. 자리 확인이 받기 시작보다 먼저: estimate → (필요 = 크기 합 × 1.05) > 남은 자리면 '자리가 모자라요' 창 + return",
     0 <= enq.find("dlSpaceLeft()") < enq.find("state.dlQueue.push") < enq.find("pumpDl()")
     and "* 1.05" in enq and re.search(r"if \(free != null && need > free\) \{ showNoSpace\(need, free\); return; \}", enq) is not None
     and "자리가 모자라요" in func_body(app, "showNoSpace") and "openMSheet(" in func_body(app, "showNoSpace")
     and "navigator.storage.estimate()" in space),
    ("A. 곡 줄 표시: trackRow 에 .dlmark (받은 곡 ↓, 받는 중 %)",
     'class="dlmark"' in row and "dlMark(t.id)" in row and '"↓"' in mark and '"%"' in mark),
    ("A. [↓ 받기] 칩: 묶음 안(#lib-playbar)·플레이리스트 상세(#s-pl .plhead)에, 다 받으면 '✓ 받음'",
     'id="btn-lib-dl"' in playbar and 'id="btn-pl-dl"' in s_pl and "paintDlChip(el.btnLibDl, g.tracks)" in group_detail
     and "paintDlChip(el.btnPlDl, tracks)" in pl_detail and "✓ 받음" in chip and "!isDl(t.id)" in chip),
    ("A. 곡 ⋯ 메뉴에 '↓ 받기' / '받은 곡 지우기'", "↓ 받기" in track_menu and "받은 곡 지우기" in track_menu and "enqueueDl([t])" in track_menu),
    ("A. 진행 한 줄 #dl-progress (받는 중 3/12곡 · 45%)",
     'id="dl-progress"' in html and "el.dlProgress.textContent" in func_body(app, "dlLine") and "받는 중 " in pump and "곡 · " in pump),
    # B. 틀기
    ("B. fetchTrackUrl 의 첫 갈래가 받은 곡: if (isDl(track.id)) return dlUrlOf(track)",
     fetch_code.startswith("if (isDl(track.id)) return dlUrlOf(track)")),
    ("B. dlUrlOf: 저장소 조각으로 Blob → blob: 주소 (드라이브·fetch 없음, 열쇠 없음)",
     "dlChunks(id)" in url_of and "new Blob(parts" in url_of and "URL.createObjectURL(" in url_of
     and re.search(r"\bfetch\b|driveFetch|getToken|tokenValid|streamUrl", strip_code(url_of)) is None),
    ("B. prefetchNext: 다음 곡이 받은 곡이면 열쇠 계산보다 먼저 곧바로 nextReady (dl 표시), 그 갈래엔 await·fetch·열쇠 없음",
     pre_dl != "" and 0 <= prefetch_code.find("isDl(t.id)") < prefetch_code.find("tokenLeftMs()")
     and prefetch_code.find("isDl(t.id)") < prefetch_code.find("streamUrl(")
     and WAIT.search(strip_code(pre_dl)) is None and "ready(state.dlUrls.get(t.id), false, true)" in pre_dl
     and re.search(r"state\.nextReady = \{ id: t\.id, pos: n, url, stream, dl \}", prefetch) is not None),
    ("B. playReady: dl 표시면 state.blobUrls 가 아니라 state.dlUrls 주소, src → play() 사이·앞에 await·fetch 없음",
     re.search(r"const url = r\.dl \? state\.dlUrls\.get\(t\.id\)", ready) is not None
     and no_wait_before(ready, "el.audio.play()")
     and 0 <= strip_code(ready).find("el.audio.src = url") < strip_code(ready).find("el.audio.play()")),
    ("B. 받은 곡 주소는 따로(state.dlUrls) — trimBlobs·refreshLibrary·setLibrary 가 안 건드림",
     "dlUrls: new Map()" in app and all("dlUrls" not in b for b in (trim, refresh, setlib))
     and "dlUrls" not in strip_code(fetch)[strip_code(fetch).find("blobUrls"):]),
    ("B. togglePlay: 받은 곡은 열쇠가 끝났어도 열쇠 요청 안 함(isDl)",
     "if (needFile && !tokenValid() && !(cur && (state.blobUrls.has(cur.id) || isDl(cur.id)))) {" in toggle),
    ("B. 오디오 오류: 받은 곡 주소면 열쇠 문제(lost)로 보지 않음",
     "const dlSrc = !!src && state.dlUrls.get(t.id) === src" in err and re.search(r"const lost = [^;]*&& !dlSrc\)", err) is not None),
    ("B. loadArt: 받은 곡이면 그 Blob(dlUrls)에서 표지 (인터넷 없이)",
     re.search(r"isDl\(t\.id\) && state\.dlUrls\.has\(t\.id\) \? state\.dlUrls\.get\(t\.id\)", art) is not None),
    # C. 저장소
    ("C. IndexedDB 하나(drive-music-dl)에 칸 두 개: tracks(keyPath id)·chunks([곡ID, 순번])",
     'const DL_DB = "drive-music-dl"' in app and "indexedDB.open(DL_DB, 1)" in db
     and 'createObjectStore("tracks", { keyPath: "id" })' in db and 'createObjectStore("chunks")' in db
     and "IDBKeyRange.bound([id, 0], [id, Infinity])" in app),
    ("C. 곡 정보에 ID·파일명·크기·종류·폴더명·폴더ID·받은 바이트·다 받음·받은 때·태그 사본",
     all(k in enq for k in ("id: t.id", "name: t.name", "size:", "mimeType:", "folderName:", "folderId:", "got: 0", "done: false", "at: 0", "tags:"))),
    ("C. localStorage: dm:dl(다 받은 곡 ID)·dm:dlqueue(곡 ID만)",
     'store.set("dl", ' in app and 'store.set("dlqueue", state.dlQueue)' in app),
    ("C. IndexedDB 를 못 쓰면 몰래 넘어가지 않음: dlOk=false → 받기 단추 끔 + '이 브라우저에선 받아 두기를 못 해요'",
     "state.dlOk = false" in load and "console.warn(" in load and 'const DL_NO = "이 브라우저에선 받아 두기를 못 해요"' in app
     and "state.dlOk === false" in chip and "btn.disabled" in chip and "DL_NO" in menu_sub and "DL_NO" in enq),
    ("C. 열쇠 든 주소를 저장소·localStorage 에 안 넣음 (받아 두기 쪽에 streamUrl·access_token 없음)",
     not leak.search(strip_code(app[app.find("// ── 받아 두기"):app.find("// ── 파일 받아오기")]))),
    # D. 관리
    ("D. ⚙ 메뉴에 '받은 곡' 줄 → openDlScreen, 작은 글씨 = N곡 · 용량 · 안 지워짐/사파리가 지울 수 있음 (persisted)",
     '"받은 곡", dlMenuSub()' in menu and "openDlScreen()" in menu
     and "안 지워짐" in menu_sub and "사파리가 지울 수 있음" in menu_sub and "state.dlPersisted" in menu_sub
     and "navigator.storage.persisted()" in load),
    ("D. 받은 곡 화면: 총 용량·남은 자리(estimate)·지워질 수 있음 한 줄",
     "dlSpaceLeft()" in render_dl and "남은 자리" in render_dl and "받은 곡 ${fmtSize(total)}" in render_dl and "state.dlPersisted" in render_dl),
    ("D. 받은 곡 화면 머리에 [▶ 재생][⇄ 섞기] 칩 → 큐 출처 {type:'offline'}, 하단 글씨 '♪ 받은 곡'",
     re.search(r'<h2>받은 곡</h2>.*?<div class="plhead">\s*<button class="chip primary" id="btn-dl-play">.*?재생</button>\s*<button class="chip" id="btn-dl-shuffle">', s_dl, re.S) is not None
     and 'setQueue({ type: "offline" }, tracks)' in play_dl and 'src.type === "offline" ? "받은 곡"' in app),
    ("D. 곡 줄마다 크기와 ✕(지우기), 받는 중이면 표시",
     "fmtSize(m.done ? m.got : m.size)" in render_dl and "dlRemove([m.id])" in render_dl and "받는 중" in render_dl),
    ("D. 전부 지우기는 확인 창(#msheet)의 빨간 버튼 ok.fn 안에서만 (dlClearAll 부르는 곳은 거기 하나)",
     re.search(r'ok: \{ label: "전부 지우기", danger: true, fn: \(\) => \{ dlClearAll\(\); \} \}', clear_confirm) is not None
     and len(re.findall(r"(?<![\w.])dlClearAll\(", code)) - len(re.findall(r"function dlClearAll\(", code)) == 1
     and 'id="btn-dl-clear"' in s_dl and "el.btnDlClear.onclick = confirmDlClear" in app),
    ("D. 지금 듣는 곡을 지우면 소리는 두고(audioUses → 미뤄 둠) 곡이 바뀌면(loadstart) 저장소에서",
     "if (href && audioUses(href)) dlPending.set(id, href)" in remove
     and 'el.audio.addEventListener("loadstart", flushDlPending)' in app and 'store.set("dldel"' in remove),
    ("D. 로그아웃은 받은 곡을 안 지움 + 확인 창 부제에 '받은 곡은 이 기기에 남아요'",
     not re.search(r"dlRemove|dlClearAll|dlDeleteRecords|indexedDB", logout) and "받은 곡은 이 기기에 남아요" in confirm_logout),
    # E. 사라짐
    ("E. 앱을 열 때 dm:dl 과 저장소를 견줘 없어진 곡 → '받은 곡이 지워졌어요 — 다시 받기' 토스트",
     re.search(r'state\.dlGone = store\.get\("dl", \[\]\)\.filter\(\(id\) => !isDl\(id\)\)', load) is not None
     and "dlGoneFound()" in load and 'const DL_GONE_MSG = "받은 곡이 지워졌어요 — 다시 받기"' in app
     and 'toast(DL_GONE_MSG, { label: "다시 받기", fn: regainDl })' in func_body(app, "dlGoneFound")),
    ("E. 틀 때 조각이 모자라면 사라짐으로 (dlLost) + 받은 곡 화면 맨 위 안내 + [다시 받기] → 받기 줄",
     "dlLost(id)" in url_of and "받은 곡이 지워졌어요" in render_dl and 'id="dl-gone"' in s_dl and 'id="btn-dl-regain"' in s_dl
     and "enqueueDl(tracks)" in func_body(app, "regainDl") and "navigator.onLine" in func_body(app, "regainDl")),
    ("E. 받은 곡이 없어져 드라이브로 틀면 조용히 넘기지 않고 '받은 곡이 지워져 드라이브에서 틀어요'",
     "state.dlGoneNote = track.id" in fetch and "navigator.onLine" in fetch
     and 'const DL_GONE_PLAY = "받은 곡이 지워져 드라이브에서 틀어요"' in app
     and "el.npSub.textContent = DL_GONE_PLAY" in after),
    # F. 오프라인
    ("F. sw.js: 구글(googleapis.com·accounts.google.com) 요청은 respondWith 전에 그냥 return (가로채지도 담지도 않음)",
     "googleapis" in sw and "accounts.google.com" in sw
     and 0 <= sw_fetch.find("if (isGoogle(url)) return;") < sw_fetch.find("respondWith")),
    ("F. sw.js: Range 요청(오디오)·blob: 은 안 맡음, Cache API 에 오디오를 안 넣음",
     'if (req.headers.has("range")) return;' in sw_fetch and "audio" not in strip_code(sw).lower()),
    ("F. sw.js: 껍데기 = index.html·app.js·config.js·manifest.json·아이콘·jsmediatags CDN, 상대경로",
     all(f'"./{f}"' in sw for f in ("index.html", "app.js", "config.js", "manifest.json", "icons/icon-192.png"))
     and "jsmediatags/3.9.5/jsmediatags.min.js" in sw and '"/' not in re.sub(r"https?://[^\"]*", "", sw)),
    ("F. sw.js: 이 앱 파일은 인터넷 먼저(fetch → 담기), 안 되면 담아 둔 것(caches.match)",
     re.search(r"event\.respondWith\(fetch\(req\)\.then\(", sw_fetch) is not None and "caches.match(req" in sw_fetch),
    ("F. 등록은 시작(init)에서 상대경로 ./sw.js", 'navigator.serviceWorker.register("./sw.js")' in init),
    ("F. 시작: 인터넷이 없거나 구글 스크립트를 못 받았으면 받은 곡이 있을 때 오프라인 목록, 없으면 로그인 화면에 안내",
     "navigator.onLine === false" in init and "window.dmGsiFailed" in init and 'startOffline("net")' in init
     and "notice(NO_NET_NO_DL)" in init and "인터넷이 없어요. 받아 둔 곡이 없어서 틀 게 없어요" in app
     and "dmGsiFailed = true" in html),
    ("F. 오프라인 목록: #s-tracks 그대로, 보관함 = 받은 곡(태그 사본), 맨 위 '인터넷이 없어요 — 받은 곡만 보여요'",
     "show(el.sTracks)" in start_off and "setLibrary(dlDoneList().map((m) => dlTrackOf(m.id)))" in start_off
     and 'id="offline-note"' in s_tracks and "인터넷이 없어요 — 받은 곡만 보여요" in app),
    ("F. 플레이리스트는 이 기기 사본에서 받은 곡만", 'state.playlists = store.get("playlists", [])' in start_off
     and re.search(r"plItemsToTracks = [^;]*\.filter\(\(t\) => !state\.offline \|\| isDl\(t\.id\)\)", app, re.S) is not None),
    ("F. 쓰는 중 offline → 받은 곡만 보이게 다시 그림, online → 원래대로 (구글 창은 저절로 안 띄움)",
     'window.addEventListener("offline", goOffline)' in app and "isDl(t.id)" in go_off and "refreshLibrary(" in go_off
     and "state.onlineLib" in go_on and "refreshLibrary(lib)" in go_on
     and not re.search(r"requestToken|login\(\)", strip_code(go_on))),
    ("F. 오프라인에선 드라이브에 쓰는 일을 막음 (태그 고치기·합치기·플레이리스트 고치기·♥)",
     all("offlineBlock()" in func_body(app, n) for n in ("openTagForm", "openRename", "openMerge", "openDropMerge", "undoLast",
                                                        "retagAll", "openTagEditor", "createPlaylist", "addToPlaylist",
                                                        "removeFromPlaylist", "renamePlaylist", "deletePlaylist", "toggleFav"))),
    ("하지 않을 것: new Audio·AudioContext·Cache API(app.js) 없음",
     re.search(r"new\s+Audio\b|AudioContext|\bcaches\.", app_nc) is None),
    # H. 문서
    ("H. README: 받기·받은 곡 화면·오프라인·일주일 뒤 확인",
     all(x in readme for x in ("↓ 받기", "받은 곡", "인터넷이 없", "일주일 뒤"))),
    ("H. CLAUDE.md: sw.js·#s-dl·dm:dl·dm:dlqueue", all(x in claude for x in ("sw.js", "#s-dl", "dm:dl", "dm:dlqueue"))),
    ("app.js 괄호 {} () [] 짝이 맞음", brackets_ok(app)),
    ("sw.js 괄호 {} () [] 짝이 맞음", brackets_ok(sw)),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
print("※ 비행기 모드·잠근 채 받은 곡 세 곡 넘기기(홈 화면 아이콘·사파리 탭 각각)는 사람이 아이폰에서")
sys.exit(1 if fail else 0)
