#!/usr/bin/env python3
"""아이폰이 뒤에 있을 때 곡이 바뀌어도 안 끊기게 한 것을 함수 몸통 단위로 확인
(이 환경엔 node·브라우저가 없어 글을 훑음 — check_playback.py 와 같은 방식. 실제 소리는 사람이 아이폰에서 봄).
 a. <audio> 하나만 (new Audio·AudioContext 없음)
 b. ended 에서 준비된 다음 곡을 기다림(await·fetch) 없이 곧바로 play()
 c. 바로 듣기 주소(alt=media + access_token), 안 되면 통째 받기로 대체하고 "대체됨" 표시
 d. 잠금화면 버튼은 한 곳에서 한 번만, ▶는 togglePlay 길
 e. 멈춘 채 돌아오면 "이어 듣기" 단추, 누르면 기다림 없이 그 자리부터
 f. 열쇠가 든 주소를 저장·console·화면에 넣지 않음
 g. 홈 화면 아이콘(standalone)일 때만 안내 한 줄
돌리기: python3 tests/check_background.py — 하나라도 빠지면 1로 끝남."""
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
    """문자열·주석·정규식 대강 빼기 (check_playback.py 와 같은 방식)"""
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
    """주석만 빼기 (문자열은 남김)"""
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


def call_args(src, name):
    """name( ... ) 마다 괄호 안 글 (짝 맞춤)"""
    out = []
    for m in re.finditer(re.escape(name) + r"\(", src):
        depth, i = 1, m.end()
        while i < len(src) and depth:
            if src[i] == "(":
                depth += 1
            elif src[i] == ")":
                depth -= 1
            i += 1
        out.append(src[m.end():i - 1])
    return out


def code_before(body, needle):
    """주석·문자열 뺀 body 에서 needle 이 처음 나오기 전까지 (없으면 None)"""
    code = strip_code(body)
    i = code.find(needle)
    return code[:i] if i >= 0 else None


WAIT = re.compile(r"\bawait\b|\bfetch\b|fetchTrackUrl|driveFetch|prefetchNext|getToken|tagBlobOf|loadArt")


def no_wait_before(body, needle):
    pre = code_before(body, needle)
    return pre is not None and WAIT.search(pre) is None


app = (ROOT / "app.js").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
app_nc = strip_comments(app)

ended = listener(app, "el.audio", "ended")
ready = func_body(app, "playReady")
nxt = func_body(app, "next")
play = func_body(app, "playCurrent")
after = func_body(app, "afterStart")
prefetch = func_body(app, "prefetchNext")
renew = func_body(app, "renewNext")
fetch = func_body(app, "fetchTrackUrl")
toggle = func_body(app, "togglePlay")
upd = func_body(app, "updateMediaSession")
setup = func_body(app, "setupMediaSession")
init = block_after(app, r"\(function init\(\)\s*\{")
err = listener(app, "el.audio", "error")
vis = block_after(app, r'document\.addEventListener\("visibilitychange",\s*\(\)\s*=>\s*\{')
check = func_body(app, "checkResume")
resume = func_body(app, "resumeNow")
stop = func_body(app, "stopPlayback")
save_resume = func_body(app, "saveResume")
sched = func_body(app, "scheduleTokenRefresh")
stream_def = re.search(r"const streamUrl\s*=\s*\(id\)\s*=>\s*`([^`]*)`", app)
fb_msg = re.search(r'const FALLBACK_MSG\s*=\s*"([^"]*)"', app)
player_html = re.search(r'<div id="player">(.*?)\n</div>', html, re.S)
tracks_html = re.search(r'<section class="screen" id="s-tracks">(.*?)</section>', html, re.S)

ended_code = strip_code(ended)
ready_code = strip_code(ready)
leak = re.compile(r"\burl\b|\bsrc\b|\.src\b|streamUrl|access_token|\btoken\b|\bu\b")

checks = [
    # (a) 오디오 하나
    ("a. new Audio · createElement(\"audio\") · AudioContext 없음",
     re.search(r"new\s+Audio\b|createElement\(\s*[\"']audio|AudioContext", app_nc) is None),
    ("a. index.html 에 <audio> 는 하나, app.js 는 그것(el.audio)만 씀",
     len(re.findall(r"<audio\b", html)) == 1 and 'audio: $("audio")' in app),
    ("a. 곡을 거는 곳은 el.audio.src 바꿔 끼우기뿐 (playCurrent·playReady)",
     "el.audio.src = url" in play and "el.audio.src = url" in ready
     and all(m.startswith("el.audio") for m in re.findall(r"[\w.]+\.src\s*=(?!=)", strip_code(app)) if "audio" in m or m == "src")),
    # (b) ended 에서 기다림 없이
    ("b. ended: 한 곡 반복이 아니면 먼저 playReady() (준비된 다음 곡), 안 되면 그때 next()",
     ended_code.find("playReady()") >= 0 and 0 <= ended_code.find("playReady()") < ended_code.find("next()")
     and "state.repeat" in ended_code),
    ("b. ended 몸통엔 await · fetch · 받기 함수가 없음", WAIT.search(ended_code) is None and ended != ""),
    ("b. playReady: state.nextReady 를 쓰고 그 곡이 지금 순서의 다음 곡(id·pos)과 같을 때만",
     "state.nextReady" in ready_code and "r.id !== t.id" in ready_code and "r.pos !== n" in ready_code
     and re.search(r"return false", ready_code) is not None),
    ("b. playReady: el.audio.src = url → el.audio.play() 순서, 그 앞에 await·fetch·받기 없음",
     0 <= ready_code.find("el.audio.src = url") < ready_code.find("el.audio.play()")
     and no_wait_before(ready, "el.audio.play()")),
    ("b. playReady: 화면 갱신·saveQueue·잠금화면 정보·그림은 play() 다음",
     all(ready_code.find(x) > ready_code.find("el.audio.play()") for x in
         ("showNowPlaying(", "saveQueue()", "updateMediaSession(", "markPlayingRow()"))
     and "loadArt" not in ready_code[:ready_code.find("el.audio.play()")]),
    ("b. ⏭(next)도 준비된 다음 곡을 먼저 씀 (playReady → 아니면 playCurrent)",
     0 <= strip_code(nxt).find("playReady()") < strip_code(nxt).find("playCurrent()")),
    ("b. 재생이 시작되면(play() 성공 뒤) 다음 곡 준비: playCurrent → afterStart → prefetchNext",
     "afterStart(t, url)" in play and play.find("afterStart(t, url)") > play.find("await el.audio.play()")
     and "prefetchNext()" in after and "afterStart(t, url)" in ready),
    ("b. prefetchNext: 바로 듣기면 state.nextReady = {id, pos, url} (받지 않고 주소만), 통째 받기면 미리 받음",
     re.search(r"state\.nextReady\s*=\s*\{\s*id:\s*t\.id,\s*pos:\s*n,\s*url", prefetch) is not None
     and "streamUrl(t.id)" in prefetch and "whole: true" in prefetch and "state.streamOff" in prefetch),
    ("b. prefetchNext: 열쇠가 '지금 곡 남은 시간 + 다음 곡(모르면 10분)'보다 짧고 화면이 앞이면 미리 새 열쇠",
     "NEXT_GUESS = 600" in app and "tokenLeftMs() < needMs" in prefetch
     and re.search(r'document\.visibilityState === "visible"\)\s*requestToken\(""\)', prefetch) is not None),
    ("b. 열쇠 끝나기 5분 전 조용히 새로 받는 타이머 (뒤에 있으면 안 받음)",
     "TOKEN_EARLY = 5 * 60_000" in app and "TOKEN_EARLY" in sched
     and re.search(r'visibilityState !== "visible"[^;]*return', sched) is not None and 'requestToken("")' in sched
     and "scheduleTokenRefresh()" in func_body(app, "requestToken")),
    ("b. 섞기·반복·큐가 바뀌면 준비한 다음 곡을 버리고 다시 (rebuildOrder·setQueue·toggleShuffle·cycleRepeat·playCurrent)",
     "state.nextReady = null" in func_body(app, "rebuildOrder") and "state.nextReady = null" in func_body(app, "setQueue")
     and "renewNext()" in func_body(app, "toggleShuffle") and "renewNext()" in func_body(app, "cycleRepeat")
     and "state.nextReady = null" in play and "prefetchNext()" in renew),
    ("b. 한 곡 반복은 그대로 el.audio.loop", 'el.audio.loop = state.repeat === "one"' in app),
    # (c) 바로 듣기 주소 + 대체
    ("c. 바로 듣기 주소 = /files/<ID>?alt=media&supportsAllDrives=true&access_token=<열쇠>",
     stream_def is not None and stream_def.group(1).startswith("${API}/files/")
     and "alt=media" in stream_def.group(1) and "supportsAllDrives=true" in stream_def.group(1)
     and "access_token=${encodeURIComponent(state.token.access_token)}" in stream_def.group(1)),
    ("c. fetchTrackUrl: 기본(통째 받기 아님)이면 받지 않고 streamUrl 을 돌려줌 — driveFetch 보다 앞",
     re.search(r"if \(!whole && !state\.streamOff\)\s*\{[^}]*return streamUrl\(track\.id\)", fetch) is not None
     and 0 <= strip_code(fetch).find("streamUrl(") < strip_code(fetch).find("driveFetch(")),
    ("c. 대체: 바로 듣기가 시작도 못 하고 오류(loadedmetadata 전) → streamOff 켜고 통째로 다시",
     all(x in block_after(err, r"if \(stream && state\.metaOk !== src && tokenValid\(\)[^\n]*\{")
         for x in ("state.streamOff = true", "playCurrent(", "return;"))
     and "state.metaOk = el.audio.src" in listener(app, "el.audio", "loadedmetadata")),
    ("c. 대체되면 조용히 넘기지 않음: 하단 글씨 '…(대체됨)' + console.warn '대체됨'",
     fb_msg is not None and "대체됨" in fb_msg.group(1) and "el.npSub.textContent = FALLBACK_MSG" in err
     and re.search(r'console\.warn\("[^"]*대체됨', err) is not None
     and "FALLBACK_MSG" in after and "state.fallbackNote = true" in err),
    ("c. 듣는 중 오류(열쇠 끝남)는 바로 듣기 주소도 '잃음'으로 쳐서 새 열쇠로 그 자리부터 한 번 다시",
     re.search(r"const lost = [^;]*\(stream \? true :", err) is not None and "playCurrent(at)" in err),
    ("c. ▶ 판단: 바로 듣기 주소의 열쇠가 끝났으면(stale) 새로 걸기 — audioFor 기준",
     re.search(r"const stale = [^;]*state\.audioFor === cur\.id[^;]*isStreamUrl\(el\.audio\.src\) && !tokenValid\(\)", toggle) is not None
     and "|| stale" in toggle and "state.audioFor = null" in stop),
    ("c. 표지: 바로 듣기면 Range 길(tagBlobOf)로 앞부분만, 재생 뒤 기다리지 않고(.then)",
     "tagBlobOf(t)" in func_body(app, "loadArt") and re.search(r"loadArt\(t, url\)\.then", after) is not None),
    # (d) MediaSession
    ("d. setActionHandler 는 setupMediaSession 한 곳에만, updateMediaSession 엔 없음",
     "setActionHandler" in setup and "setActionHandler" not in upd
     and app_nc.count("setActionHandler") == strip_comments(setup).count("setActionHandler")),
    ("d. 잠금화면 ▶ → togglePlay(\"play\") (주소가 없거나 열쇠가 끊겨도 다시 걸어 틂), ⏸ 는 wantPlay 끔",
     re.search(r'set\("play",\s*\(\)\s*=>\s*togglePlay\("play"\)\)', setup) is not None
     and re.search(r'set\("pause",[^\n]*state\.wantPlay = false', setup) is not None),
    ("d. setupMediaSession 은 시작(init)에서 한 번", "setupMediaSession()" in init
     and len(re.findall(r"(?<!function )setupMediaSession\(\)", app_nc)) == 1),
    ("d. playbackState 를 play·pause 이벤트에 맞추고, setPositionState 는 try 로",
     'setPlaybackState("playing")' in listener(app, "el.audio", "play")
     and 'setPlaybackState("paused")' in listener(app, "el.audio", "pause")
     and re.search(r"try \{ navigator\.mediaSession\.setPositionState\(", app) is not None),
    # (e) 이어 듣기
    ("e. visibilitychange: hidden 이면 자리 적기(saveResume), visible 이면 checkResume",
     vis != "" and re.search(r'"hidden"\)\s*\{\s*saveResume\(\);\s*return;', vis) is not None and "checkResume()" in vis
     and 'window.addEventListener("pageshow", checkResume)' in app),
    ("e. checkResume: wantPlay 인데 el.audio.paused 면(또는 열쇠 끊김) 이어 듣기 단추를 보임",
     "state.wantPlay && el.audio.paused" in check and "state.tokenLost" in check
     and re.search(r'el\.btnResume\.classList\.toggle\("hidden", !want\)', check) is not None),
    ("e. 이어 듣기 단추가 #player 안에 있음 (글씨 '이어 듣기'), 누르면 resumeNow",
     player_html is not None and 'id="btn-resume"' in player_html.group(1) and "이어 듣기" in player_html.group(1)
     and "el.btnResume.onclick = resumeNow" in app),
    ("e. resumeNow: 주소가 살아 있으면 el.audio.play() 만, 아니면 togglePlay(\"play\", at) — 둘 다 앞에 await 없음",
     "el.audio.play()" in resume and 'togglePlay("play", at)' in resume
     and no_wait_before(resume, "el.audio.play()") and no_wait_before(resume, 'togglePlay(')),
    ("e. togglePlay: startAt 이 오면 playCurrent(at) 로 그 자리부터, 그 앞에 await 없음",
     re.search(r"const at = startAt != null \? startAt", toggle) is not None and "playCurrent(at)" in toggle
     and re.search(r"\bawait\b", strip_code(toggle)) is None),
    ("e. 듣는 자리(곡 ID + 초)를 몇 초마다·뒤로 갈 때 dm:resume 에",
     re.search(r'store\.set\("resume", \{ folderId: [^}]*id: cur\.id, at: ', save_resume) is not None
     and "saveResume()" in listener(app, "el.audio", "timeupdate")),
    ("e. wantPlay: 재생되면 켜고(playing), 사람이 멈추면 끔(⏸·잠금화면·stopPlayback)",
     "state.wantPlay = true" in listener(app, "el.audio", "playing") and "hideResume()" in listener(app, "el.audio", "playing")
     and re.search(r'if \(mode !== "play"\) \{ state\.wantPlay = false; el\.audio\.pause\(\); \}', toggle) is not None
     and "state.wantPlay = false" in stop),
    ("e. 시스템이 멈춘 pause 이벤트는 wantPlay 를 안 끔", "wantPlay = false" not in listener(app, "el.audio", "pause")),
    ("e. 열쇠 끊김 안내도 같은 단추로 (tokenFail → checkResume)",
     re.search(r"state\.tokenLost = true; checkResume\(\)", play) is not None),
    # (f) 열쇠 든 주소 새지 않게
    ("f. store.set 에 주소·열쇠가 안 들어감",
     all(not leak.search(strip_code(a.split(",", 1)[1] if "," in a else "")) for a in call_args(app_nc, "store.set"))),
    ("f. console.* 에 주소·열쇠가 안 들어감",
     all(not leak.search(strip_code(a)) for k in ("console.log", "console.warn", "console.error", "console.info")
         for a in call_args(app_nc, k))),
    ("f. 화면 글씨(textContent·toast)에 주소가 안 들어감",
     all(not re.search(r"\burl\b|\.src\b|streamUrl|access_token", strip_code(m))
         for m in re.findall(r"textContent\s*=\s*([^;]*);", app_nc) + call_args(app_nc, "toast"))),
    ("f. dm:queue 는 곡 ID 만 (ids: map t.id)",
     re.search(r'store\.set\("queue", \{[^}]*ids: state\.tracks\.map\(\(t\) => t\.id\)', app) is not None),
    # (g) standalone 안내
    ("g. 홈 화면 아이콘 판단: navigator.standalone 또는 display-mode: standalone",
     "navigator.standalone === true" in app and 'matchMedia("(display-mode: standalone)")' in app),
    ("g. 곡 목록 화면 위 안내 한 줄 + ✕ 로 닫고 기억",
     tracks_html is not None and 'id="standalone-note"' in tracks_html.group(1)
     and "사파리 탭으로 열어 보세요" in tracks_html.group(1) and 'id="standalone-note-x"' in tracks_html.group(1)
     and 'store.set("standalonenote", true)' in app
     and re.search(r'standaloneNote\.classList\.toggle\("hidden", !standalone', app) is not None),
    ("g. README: 이어 듣기 · 사파리 탭 안내", "이어 듣기" in readme and "사파리 탭" in readme),
    ("app.js 괄호 {} () [] 짝이 맞음", brackets_ok(app)),
]

fail = 0
for name, ok in checks:
    print(("통과  " if ok else "실패  ") + name)
    fail += not ok
print(f"\n{len(checks) - fail}/{len(checks)} 통과")
print("※ 실제 아이폰(잠금·다른 앱 앞에 둠·홈 화면 아이콘/사파리 탭)에서 듣는 건 사람 몫")
sys.exit(1 if fail else 0)
