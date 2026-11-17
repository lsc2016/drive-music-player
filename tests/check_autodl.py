#!/usr/bin/env python3
"""k12 자동 받기 연결과 기기별 설정 검사."""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
app = (root / "app.js").read_text()
html = (root / "index.html").read_text()

def body(name):
    m = re.search(r"function\s+" + name + r"\s*\([^)]*\)\s*\{", app)
    if not m: return ""
    depth = 1
    for i in range(m.end(), len(app)):
        if app[i] == "{": depth += 1
        elif app[i] == "}":
            depth -= 1
            if not depth: return app[m.end():i]
    return ""

def has(name, *parts): return all(p in body(name) for p in parts)
checks = {
    "곡 추가에서 동기화": has("addToPlaylist", "autoDlSync()"),
    "켜진 목록의 미완료 곡만": has("autoDlTargets", "autoNames()", "names.includes", "plItemsToTracks", "!isDl", "!state.dlQueue.includes", "!dlPending.has"),
    "k12 연결과 망 확인 후 자동 대기열": has("autoDlSync", "K12", "state.offline", "navigator.onLine", 'state.folder.id !== "k12"', "autoNetOk()", "enqueueDl(targets, {auto: true})"),
    "자동 표시와 공간 부족 처리": has("enqueueDl", "m.auto = true", "if (auto)", "showNoSpace", "autoSpaceWarned"),
    "자동 곡 망 제한과 수동 곡 우선": has("pumpDl", "autoNetOk()", "!m.auto", "autoWait()"),
    "기본 와이파이와 알 수 없으면 거부": has("autoNetOk", '"wifi"', '"any"', 'type === "wifi"', 'type === "ethernet"'),
    "끄면 미완료 자동 곡만 제외": has("cancelAutoDl", "names.includes", "m.auto", "!m.done", "!keep.has(id)", "dlRemove(ids)"),
    "이름 변경과 삭제에서 기기 설정 갱신": has("renamePlaylist", 'store.set("autodl"') and has("deletePlaylist", 'store.set("autodl"', "cancelAutoDl()"),
    "받은 곡 표시와 설정": has("renderDl", "m.auto", "저절로") and "저절로 받기" in body("openSettingsMenu"),
    "목록 읽기·충돌·연결·복귀 동기화": all("autoDlSync()" in body(n) for n in ("loadPlaylists", "flushPlaylists", "openK12")) and 'addEventListener("online", autoDlSync)'  in app and 'addEventListener("visibilitychange"' in app and 'connection.addEventListener("change"' in app,
    "플레이리스트 머리 칩과 줄바꿈": bool(re.search(r'<section[^>]*id="s-pl".*?<div class="plhead">.*?id="btn-pl-dl".*?id="btn-pl-auto"', html, re.S)) and bool(re.search(r'\.plhead\s*\{[^}]*flex-wrap:\s*wrap', html)),
    "대기 안내와 지금 받기": has("autoWait", "와이파이인지 알 수 없어 기다려요", "지금 받기", "autoOverride = true", "pumpDl()"),
}
for name, ok in checks.items(): print(("통과 " if ok else "실패 ") + name)
print(f"{sum(checks.values())}/{len(checks)} 통과")
raise SystemExit(not all(checks.values()))
