from pathlib import Path
import subprocess
import tempfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.k12_server import read_data

s = Path("app.js").read_text()
h = Path("index.html").read_text()
def body(name):
    start = s.index("function " + name + "(")
    begin = s.index(" {", s.index(")", start)) + 1
    depth, i = 1, begin + 1
    while depth and i < len(s):
        if s[i] == "{": depth += 1
        elif s[i] == "}": depth -= 1
        i += 1
    return s[begin:i]

opening = body("openK12")
catch = opening[opening.index("try {"):opening.index("finally")]
assert "./api/tracks" in catch and "loadPlaylists" not in catch and "loadTagDb" not in catch and "readK12Parts" not in catch
assert "if (K12) { state.libVer = null; throw e; }" in body("loadTagDb")
assert all(x in h for x in ('id="data-note"', 'id="btn-data-retry"', 'class="linkbtn"', '#btn-data-retry { min-height: 40px; }'))
assert all(x in s for x in ("플레이리스트를 못 읽었어요", "태그 보관함을 못 읽었어요", '"다시 읽는 중…"'))
assert '8000' in body("readK12Data") and 'Promise.race' in body("readK12Data")
assert all(x in s for x in ('k12 음악', 'k12 에 둔 음악을 받아 두고 들어요.', 'el.loginTitle.textContent', 'el.loginDesc.textContent'))
assert 'html:has(meta[name="dm-source"][content="k12"]) #btn-login' in h
with tempfile.TemporaryDirectory() as d:
    assert read_data(Path(d), "playlists") == (200, b"", "none")
    assert read_data(Path(d), "library") == (200, b"", "none")
    assert read_data(Path(d), "other") == (404, b"", None)

# Run the actual loading and opening functions with in-memory responses, without sockets.
functions = "\n".join(("async " if name in ("readK12Data", "loadPlaylists", "readK12Parts", "openK12") else "") + "function " + name + "(" + s.split("function " + name + "(", 1)[1].split(")", 1)[0] + ") " + body(name) for name in ("readK12Data", "loadPlaylists", "loadTagDb", "paintDataNote", "readK12Parts", "openK12"))
js = r'''
const assert = require("assert");
const K12 = true;
const state = {tagDb: new Map(), playlists: []};
const store = { get: (k, v) => v, set: () => {} };
const node = () => ({textContent: "", innerHTML: "", classList: {toggle() {}, add() {}, remove() {}}});
const el = {plSync:node(), dataText:node(), dataNote:node(), sTracks:node(), sLogin:node(), hdrSub:node(), tracksTitle:node(), offlineText:node(), btnOfflineLogin:node(), btnLogin:node(), btnLoginDl:node()};
let tagDbLoading = null, dataFailures = {}, statuses = {}, shown = false, disconnected = false;
const parsePlaylists = x => x ? [x] : [], parseLibrary = x => new Map(x ? [["id", x]] : []);
const plShown = () => false, renderPlaylistList = () => {}, renderPlaylistDetail = () => {}, updateFavUI = () => {}, autoDlSync = () => {};
const setOfflineNote = () => {}, notice = x => { if (x.includes("닿지")) disconnected = true; }, show = x => { if (x === el.sTracks) shown = true; };
const showTab = () => {}, setLibrary = x => { state.library = x; }, stripExt = x => x, scanTags = () => {}, pumpDl = () => {};
const loadDl = async () => {}, dlDoneList = () => [], startOffline = () => {};
global.fetch = async url => { const status = statuses[url] || 200; return {ok: status === 200, status, headers:{get:()=>"none"}, text:async()=>"", json:async()=>({tracks:[{name:"song"}]})}; };
''' + functions + r'''
(async () => {
  for (const status of [404, 500]) {
    for (const paths of [["playlists"], ["library"], ["playlists", "library"]]) {
      statuses = {}; for (const path of paths) statuses["./api/data/" + path] = status;
      shown = false; disconnected = false; tagDbLoading = null;
      await openK12();
      assert(shown && !disconnected && state.library.length === 1);
      assert.equal(dataFailures.playlists, paths.includes("playlists"));
      assert.equal(dataFailures.library, paths.includes("library"));
      if (paths.includes("playlists")) assert(el.dataText.textContent.includes("플레이리스트를 못 읽었어요") && el.plSync.textContent === "못 읽음");
      if (paths.includes("library")) assert(el.dataText.textContent.includes("태그 보관함을 못 읽었어요"));
      statuses = {}; await readK12Parts(dataFailures.playlists, dataFailures.library);
      assert(!dataFailures.playlists && !dataFailures.library && !el.dataText.textContent);
    }
  }
  statuses = {}; tagDbLoading = null; await openK12();
  assert(shown && !dataFailures.playlists && !dataFailures.library && state.playlists.length === 0 && state.tagDb.size === 0);
  console.log("404 · 500 · 빈 200 · 재시도 통과");
})().catch(e => { console.error(e); process.exit(1); });
'''
subprocess.run(["node", "-e", js], check=True)
print("k12 자료 실패 검사 통과")
