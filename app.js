/* Drive Music — 구글 드라이브를 저장소로 쓰는 음악 플레이어
 *
 * 흐름: 구글 로그인(열쇠 받기) → 폴더 고르기 → 음악 목록 → 재생
 * 파일은 드라이브에서 바로 받아와 브라우저 메모리에서만 재생합니다.
 */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  // drive.readonly: 음악 읽기 / drive.file: 이 앱이 만든 파일(플레이리스트 .md)만 쓰기
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const PL_FILE = "drive-music-playlists.md";   // 드라이브에 저장되는 플레이리스트 파일
  const FAV = "즐겨찾기";                         // ♥ 누르면 들어가는 기본 플레이리스트
  const AUDIO_EXT = ["mp3", "m4a", "flac", "wav", "ogg", "aac", "opus", "wma", "aiff"];

  // ── 화면 요소 ──────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    hdrSub: $("hdr-sub"),
    btnBack: $("btn-back"), btnFolder: $("btn-folder"), btnRefresh: $("btn-refresh"), btnLogout: $("btn-logout"),
    sLogin: $("s-login"), sFolder: $("s-folder"), sTracks: $("s-tracks"), sPl: $("s-pl"),
    tabLib: $("tab-lib"), tabPl: $("tab-pl"), viewLib: $("view-lib"), viewPl: $("view-pl"),
    plList: $("pl-list"), plEmpty: $("pl-empty"), plSync: $("pl-sync"), plNewName: $("pl-new-name"), btnPlNew: $("btn-pl-new"),
    plTitle: $("pl-title"), plCount: $("pl-count"), plTracks: $("pl-tracks"), plTracksEmpty: $("pl-tracks-empty"),
    btnPlPlay: $("btn-pl-play"), btnPlShuffle: $("btn-pl-shuffle"), btnPlEdit: $("btn-pl-edit"),
    btnPlRename: $("btn-pl-rename"), btnPlDelete: $("btn-pl-delete"),
    dim: $("dim"), sheet: $("sheet"), sheetTrack: $("sheet-track"), sheetList: $("sheet-list"),
    sheetNewName: $("sheet-new-name"), btnSheetNew: $("btn-sheet-new"), toast: $("toast"),
    btnFav: $("btn-fav"), icFavOff: $("ic-fav-off"), icFavOn: $("ic-fav-on"),
    btnLogin: $("btn-login"), loginNotice: $("login-notice"),
    folderQ: $("folder-q"), btnFolderSearch: $("btn-folder-search"),
    folderList: $("folder-list"), folderEmpty: $("folder-empty"),
    tracksTitle: $("tracks-title"), tracksCount: $("tracks-count"),
    trackList: $("track-list"), tracksEmpty: $("tracks-empty"),
    player: $("player"), npTitle: $("np-title"), npSub: $("np-sub"), npLoading: $("np-loading"),
    tCur: $("t-cur"), tDur: $("t-dur"), seek: $("seek"),
    btnShuffle: $("btn-shuffle"), btnPrev: $("btn-prev"), btnPlay: $("btn-play"),
    btnNext: $("btn-next"), btnRepeat: $("btn-repeat"),
    icPlay: $("ic-play"), icPause: $("ic-pause"), icRepeat: $("ic-repeat"), icRepeat1: $("ic-repeat1"),
    audio: $("audio"),
  };

  // ── 상태 ──────────────────────────────────────────────────
  const state = {
    token: null,          // { access_token, expires_at }
    tokenClient: null,
    folder: null,         // { id, name }
    library: [],          // 폴더에서 긁어온 전체 곡 [{ id, name, title, size, mimeType, folderName }]
    tracks: [],           // 지금 "재생 중인 출처"의 곡들 (전체 곡 또는 플레이리스트 하나)
    source: { type: "library" },   // { type:"library" } | { type:"playlist", name }
    playlists: [],        // [{ name, items: [{ id, title, folderName }] }]
    plFileId: null,       // 드라이브에 있는 플레이리스트 파일 id
    plDirty: false, plSaveTimer: null,
    openPl: null,         // 상세 화면에 열린 플레이리스트 이름
    plEditing: false,
    sheetTrack: null,     // 바텀시트에 올라온 곡
    order: [],            // 재생 순서 (인덱스 배열) — 섞기면 섞인 순서
    pos: -1,              // order 안에서의 현재 위치
    shuffle: false,
    repeat: "off",        // off | all | one
    blobUrls: new Map(),  // trackId -> objectURL (받아둔 파일)
    loadingId: null,
    seeking: false,
  };

  const store = {
    get: (k, d) => { try { const v = localStorage.getItem("dm:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem("dm:" + k, JSON.stringify(v)); } catch {} },
    del: (k) => { try { localStorage.removeItem("dm:" + k); } catch {} },
  };

  // ── 도우미 ─────────────────────────────────────────────────
  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${r < 10 ? "0" : ""}${r}`;
  };
  const fmtSize = (b) => {
    b = Number(b || 0);
    if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
    if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
    if (b > 1e3) return (b / 1e3).toFixed(0) + " KB";
    return b + " B";
  };
  const stripExt = (n) => n.replace(/\.[^.]+$/, "");
  const isAudioName = (n) => AUDIO_EXT.includes((n.split(".").pop() || "").toLowerCase());
  const show = (screen) => {
    for (const s of [el.sLogin, el.sFolder, el.sTracks, el.sPl]) s.classList.toggle("show", s === screen);
    const signedIn = screen !== el.sLogin;
    el.btnBack.classList.toggle("hidden", screen !== el.sPl);
    el.btnFolder.classList.toggle("hidden", !signedIn || screen === el.sPl);
    el.btnRefresh.classList.toggle("hidden", screen !== el.sTracks);
    el.btnLogout.classList.toggle("hidden", !signedIn || screen === el.sPl);
    window.scrollTo(0, 0);
  };
  let toastTimer = null;
  const toast = (msg) => {
    el.toast.textContent = msg; el.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1800);
  };
  const notice = (msg, ok = false) => {
    el.loginNotice.textContent = msg;
    el.loginNotice.classList.toggle("ok", ok);
    el.loginNotice.classList.toggle("hidden", !msg);
  };

  // ── 로그인 (구글 열쇠 받기) ─────────────────────────────────
  function tokenValid() {
    return state.token && state.token.access_token && Date.now() < state.token.expires_at - 60_000;
  }

  function ensureTokenClient() {
    if (state.tokenClient) return true;
    if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // requestToken 에서 매번 바꿔 끼움
    });
    return true;
  }

  // prompt: "" 면 이미 허락한 계정이면 창 없이 조용히 갱신
  function requestToken(prompt = "") {
    return new Promise((resolve, reject) => {
      if (!ensureTokenClient()) return reject(new Error("구글 로그인 스크립트가 아직 안 불러와졌어요. 잠시 후 다시 눌러주세요."));
      state.tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        state.token = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in || 3600) * 1000 };
        sessionStorage.setItem("dm:token", JSON.stringify(state.token));
        resolve(state.token);
      };
      state.tokenClient.error_callback = (e) => reject(new Error(e && e.message ? e.message : "로그인 창이 닫혔어요."));
      state.tokenClient.requestAccessToken({ prompt });
    });
  }

  async function getToken() {
    if (tokenValid()) return state.token.access_token;
    try { await requestToken(""); } catch { await requestToken("consent"); }
    return state.token.access_token;
  }

  async function login() {
    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.includes("여기에")) {
      notice("config.js 에 클라이언트 ID가 아직 없어요.\nREADME.md 의 1번 순서대로 열쇠를 받아서 붙여넣어 주세요.");
      return;
    }
    el.btnLogin.disabled = true;
    notice("");
    try {
      await requestToken(state.token ? "" : "select_account");
      await afterLogin();
    } catch (e) {
      notice("로그인에 실패했어요: " + e.message + (/origin|redirect|invalid_client|idpiframe/i.test(e.message)
        ? "\n\n→ 구글 클라우드 콘솔의 '승인된 JavaScript 원본'에 지금 이 주소(" + location.origin + ")가 들어있는지 확인해 주세요."
        : ""));
    } finally {
      el.btnLogin.disabled = false;
    }
  }

  function logout() {
    if (state.token && window.google) try { google.accounts.oauth2.revoke(state.token.access_token, () => {}); } catch {}
    state.token = null;
    sessionStorage.removeItem("dm:token");
    stopPlayback();
    state.playlists = []; state.plFileId = null; state.library = [];
    show(el.sLogin);
    notice("로그아웃했어요.", true);
  }

  async function afterLogin() {
    loadPlaylists().catch((e) => { el.plSync.textContent = "불러오기 실패"; console.warn(e); });
    const saved = store.get("folder", null);
    if (saved && saved.id) {
      await openFolder(saved);
    } else if (CFG.DEFAULT_FOLDER_NAME) {
      const list = await listFolders(CFG.DEFAULT_FOLDER_NAME);
      const hit = list.find((f) => f.name === CFG.DEFAULT_FOLDER_NAME) || list[0];
      if (hit) await openFolder(hit); else await showFolderPicker();
    } else {
      await showFolderPicker();
    }
  }

  // ── 드라이브 API ───────────────────────────────────────────
  async function driveFetch(path, params = {}, opts = {}) {
    const token = await getToken();
    const url = new URL((opts.upload ? UPLOAD_API : API) + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token } });
    if (res.status === 401) { // 열쇠가 만료됐으면 한 번 더
      state.token = null;
      const t2 = await getToken();
      res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + t2 } });
    }
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch {}
      throw new Error(msg);
    }
    return res;
  }

  async function listAll(q, fields, orderBy = "name") {
    const out = [];
    let pageToken = "";
    do {
      const res = await driveFetch("/files", {
        q, fields: `nextPageToken, files(${fields})`, pageSize: "1000", orderBy,
        supportsAllDrives: "true", includeItemsFromAllDrives: "true", pageToken,
      });
      const j = await res.json();
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    return out;
  }

  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  async function listFolders(query) {
    let q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    if (query) q += ` and name contains '${esc(query)}'`;
    return listAll(q, "id, name, modifiedTime, parents", query ? "name" : "modifiedTime desc");
  }

  async function listAudioIn(folder) {
    // 하위 폴더까지 차례로 뒤짐 (너무 깊어지지 않게 200 폴더까지)
    const queue = [{ id: folder.id, name: folder.name, depth: 0 }];
    const tracks = [];
    let visited = 0;
    while (queue.length && visited < 200) {
      const f = queue.shift(); visited++;
      const extQ = AUDIO_EXT.map((e) => `name contains '.${e}'`).join(" or ");
      const q = `'${f.id}' in parents and trashed = false and (mimeType contains 'audio/' or ${extQ}` +
        (CFG.INCLUDE_SUBFOLDERS ? " or mimeType = 'application/vnd.google-apps.folder')" : ")");
      const items = await listAll(q, "id, name, mimeType, size");
      for (const it of items) {
        if (it.mimeType === "application/vnd.google-apps.folder") {
          if (CFG.INCLUDE_SUBFOLDERS && f.depth < 6) queue.push({ id: it.id, name: it.name, depth: f.depth + 1 });
        } else if (it.mimeType.startsWith("audio/") || isAudioName(it.name)) {
          tracks.push({ id: it.id, name: it.name, title: stripExt(it.name), size: it.size, mimeType: it.mimeType, folderName: f.name });
        }
      }
    }
    // 폴더 이름 → 파일 이름 순으로 정렬 (앨범 순서가 유지되도록)
    const coll = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
    tracks.sort((a, b) => coll.compare(a.folderName, b.folderName) || coll.compare(a.name, b.name));
    return tracks;
  }

  // ── 폴더 고르기 화면 ────────────────────────────────────────
  async function showFolderPicker() {
    show(el.sFolder);
    el.hdrSub.textContent = "";
    await searchFolders();
    el.folderQ.focus();
  }

  async function searchFolders() {
    el.folderList.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    el.folderEmpty.classList.add("hidden");
    try {
      const folders = await listFolders(el.folderQ.value.trim());
      el.folderList.innerHTML = "";
      if (!folders.length) { el.folderEmpty.classList.remove("hidden"); return; }
      for (const f of folders.slice(0, 100)) {
        const b = document.createElement("button");
        b.className = "row";
        b.innerHTML = `<div class="ic"><svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg></div>
          <div class="t"><div class="n"></div><div class="s"></div></div>`;
        b.querySelector(".n").textContent = f.name;
        b.querySelector(".s").textContent = "수정: " + new Date(f.modifiedTime).toLocaleDateString("ko-KR");
        b.onclick = () => openFolder({ id: f.id, name: f.name });
        el.folderList.appendChild(b);
      }
    } catch (e) {
      el.folderList.innerHTML = `<div class="notice">폴더를 못 불러왔어요: ${e.message}</div>`;
    }
  }

  // ── 재생목록 화면 ──────────────────────────────────────────
  async function openFolder(folder) {
    state.folder = folder;
    store.set("folder", folder);
    show(el.sTracks);
    el.hdrSub.textContent = folder.name;
    el.tracksTitle.textContent = folder.name;
    el.tracksCount.textContent = "";
    el.trackList.innerHTML = `<div class="empty"><span class="spinner"></span> 음악 찾는 중…</div>`;
    el.tracksEmpty.classList.add("hidden");
    showTab("lib");
    try {
      const tracks = await listAudioIn(folder);
      setLibrary(tracks);
    } catch (e) {
      el.trackList.innerHTML = `<div class="notice">목록을 못 불러왔어요: ${e.message}</div>`;
    }
  }

  function setLibrary(tracks) {
    // 이전에 받아둔 파일은 비움
    for (const u of state.blobUrls.values()) URL.revokeObjectURL(u);
    state.blobUrls.clear();
    state.library = tracks;
    el.tracksCount.textContent = tracks.length ? `${tracks.length}곡` : "";
    el.tracksEmpty.classList.toggle("hidden", tracks.length > 0);

    // 출처를 전체 곡으로 — 플레이리스트를 듣던 중이면 그대로 둠
    if (state.source.type === "library" || !state.tracks.length) {
      state.source = { type: "library" };
      state.tracks = tracks;
      rebuildOrder();
      // 지난번 듣던 곡이 있으면 그 자리로 (자동 재생은 안 함 — 폰 브라우저가 막음)
      const last = store.get("last:" + state.folder.id, null);
      if (last && tracks.length) {
        const i = tracks.findIndex((t) => t.id === last.id);
        if (i >= 0) { state.pos = state.order.indexOf(i); showNowPlaying(tracks[i]); el.player.classList.add("show"); }
      }
    }
    renderTracks();
  }

  // 출처(전체 곡 / 플레이리스트)를 바꿔서 재생 큐를 새로 만듦
  function setQueue(source, tracks) {
    state.source = source;
    state.tracks = tracks;
    state.pos = -1;
    rebuildOrder();
  }

  // 곡 한 줄 (전체 곡·플레이리스트·바텀시트가 같이 씀)
  const SVG_NOTE = `<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`;
  const SVG_PLUS = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  function trackRow(t, i, { playing, onPlay, onAdd, sub }) {
    const b = document.createElement("div");
    b.className = "row" + (playing ? " playing" : "");
    b.dataset.id = t.id;
    b.innerHTML = `<span class="num">${i + 1}</span>
      <div class="ic">${SVG_NOTE}</div>
      <button class="t" style="text-align:left;flex:1;min-width:0;padding:0"><div class="n"></div><div class="s"></div></button>`;
    b.querySelector(".n").textContent = t.title;
    b.querySelector(".s").textContent = sub;
    b.querySelector(".t").onclick = onPlay;
    if (onAdd) {
      const a = document.createElement("button");
      a.className = "act add"; a.title = "플레이리스트에 담기"; a.innerHTML = SVG_PLUS; a.onclick = onAdd;
      b.appendChild(a);
    }
    return b;
  }

  function renderTracks() {
    el.trackList.innerHTML = "";
    const cur = currentTrack();
    let lastFolder = null;
    state.library.forEach((t, i) => {
      if (CFG.INCLUDE_SUBFOLDERS && t.folderName !== lastFolder && t.folderName !== state.folder.name) {
        const h = document.createElement("div");
        h.className = "sectionhead"; h.style.marginTop = "14px";
        h.innerHTML = `<h2 style="font-size:13px;color:var(--muted)"></h2>`;
        h.querySelector("h2").textContent = t.folderName;
        el.trackList.appendChild(h);
      }
      lastFolder = t.folderName;
      el.trackList.appendChild(trackRow(t, i, {
        playing: !!cur && cur.id === t.id,
        sub: fmtSize(t.size),
        onPlay: () => { if (state.source.type !== "library") setQueue({ type: "library" }, state.library); playIndex(i); },
        onAdd: () => openSheet(t),
      }));
    });
  }

  function markPlayingRow() {
    const cur = currentTrack();
    for (const r of document.querySelectorAll("#track-list .row, #pl-tracks .row")) r.classList.toggle("playing", !!cur && r.dataset.id === cur.id);
    updateFavUI();
  }

  // ── 탭 ─────────────────────────────────────────────────────
  function showTab(which) {
    el.tabLib.classList.toggle("on", which === "lib");
    el.tabPl.classList.toggle("on", which === "pl");
    el.viewLib.classList.toggle("hidden", which !== "lib");
    el.viewPl.classList.toggle("hidden", which !== "pl");
    if (which === "pl") renderPlaylistList();
  }

  // ── 플레이리스트: 드라이브의 .md 파일로 저장 ─────────────────
  //  파일 모양:
  //  # Drive Music 플레이리스트
  //  ## 출근길
  //  - 곡 제목 | 드라이브파일ID | 폴더이름
  function serializePlaylists() {
    const lines = ["# Drive Music 플레이리스트", "", "<!-- 이 파일은 Drive Music 앱이 관리합니다. 직접 고쳐도 되지만 줄 모양(- 제목 | 파일ID | 폴더)은 지켜주세요. -->", ""];
    for (const p of state.playlists) {
      lines.push(`## ${p.name}`, "");
      for (const it of p.items) lines.push(`- ${it.title.replace(/\|/g, "∣")} | ${it.id} | ${(it.folderName || "").replace(/\|/g, "∣")}`);
      lines.push("");
    }
    return lines.join("\n");
  }
  function parsePlaylists(text) {
    const out = []; let cur = null;
    for (const raw of (text || "").split(/\r?\n/)) {
      const line = raw.trim();
      const h = line.match(/^##\s+(.+)$/);
      if (h) { cur = { name: h[1].trim(), items: [] }; out.push(cur); continue; }
      const m = line.match(/^-\s+(.*?)\s*\|\s*([A-Za-z0-9_-]{10,})\s*(?:\|\s*(.*))?$/);
      if (m && cur) cur.items.push({ title: m[1], id: m[2], folderName: (m[3] || "").trim() });
    }
    return out;
  }

  async function loadPlaylists() {
    // 먼저 이 기기에 남은 복사본으로 바로 보여주고, 드라이브 것으로 덮어씀
    state.playlists = store.get("playlists", []);
    el.plSync.innerHTML = `<span class="spinner"></span>`;
    const res = await driveFetch("/files", {
      q: `name = '${PL_FILE}' and trashed = false`, fields: "files(id, name, modifiedTime)", spaces: "drive", pageSize: "1",
    });
    const j = await res.json();
    if (j.files && j.files.length) {
      state.plFileId = j.files[0].id;
      const r2 = await driveFetch(`/files/${state.plFileId}`, { alt: "media" });
      state.playlists = parsePlaylists(await r2.text());
      store.set("playlists", state.playlists);
    }
    el.plSync.textContent = state.playlists.length ? `${state.playlists.length}개` : "";
    if (!el.viewPl.classList.contains("hidden")) renderPlaylistList();
    if (state.openPl) renderPlaylistDetail();
    updateFavUI();
  }

  function savePlaylists() {
    store.set("playlists", state.playlists);
    state.plDirty = true;
    el.plSync.textContent = "저장 중…";
    clearTimeout(state.plSaveTimer);
    state.plSaveTimer = setTimeout(flushPlaylists, 1200);  // 연달아 고칠 때 한 번만 올림
  }
  async function flushPlaylists() {
    if (!state.plDirty) return;
    state.plDirty = false;
    try {
      const body = serializePlaylists();
      if (state.plFileId) {
        await driveFetch(`/files/${state.plFileId}`, { uploadType: "media" },
          { method: "PATCH", upload: true, headers: { "Content-Type": "text/markdown" }, body });
      } else {
        const meta = { name: PL_FILE, mimeType: "text/markdown" };
        const boundary = "dm" + Date.now();
        const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
          `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${body}\r\n--${boundary}--`;
        const res = await driveFetch("/files", { uploadType: "multipart", fields: "id" },
          { method: "POST", upload: true, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
        state.plFileId = (await res.json()).id;
      }
      el.plSync.textContent = state.playlists.length ? `${state.playlists.length}개` : "";
    } catch (e) {
      state.plDirty = true;
      el.plSync.textContent = "저장 실패 — 다시 시도함";
      setTimeout(flushPlaylists, 5000);
    }
  }
  window.addEventListener("pagehide", () => { if (state.plDirty) flushPlaylists(); });

  // ── 플레이리스트: 고치기 ────────────────────────────────────
  const getPl = (name) => state.playlists.find((p) => p.name === name);
  function createPlaylist(name) {
    name = (name || "").trim();
    if (!name) return null;
    if (getPl(name)) { toast("같은 이름이 이미 있어요"); return getPl(name); }
    const p = { name, items: [] };
    state.playlists.push(p);
    savePlaylists();
    return p;
  }
  function addToPlaylist(name, t) {
    const p = getPl(name) || createPlaylist(name);
    if (!p) return;
    if (p.items.some((it) => it.id === t.id)) return;
    p.items.push({ id: t.id, title: t.title, folderName: t.folderName || "" });
    savePlaylists();
  }
  function removeFromPlaylist(name, id) {
    const p = getPl(name); if (!p) return;
    p.items = p.items.filter((it) => it.id !== id);
    savePlaylists();
  }
  const inPlaylist = (name, id) => { const p = getPl(name); return !!p && p.items.some((it) => it.id === id); };

  // 플레이리스트 항목 → 재생할 곡 (라이브러리에 있으면 그 정보를, 없으면 저장된 정보로)
  const plItemsToTracks = (p) => p.items.map((it) => state.library.find((t) => t.id === it.id) ||
    ({ id: it.id, name: it.title, title: it.title, size: 0, mimeType: "audio/", folderName: it.folderName }));

  // ── 플레이리스트: 목록 화면(탭) ─────────────────────────────
  const SVG_PL = `<svg viewBox="0 0 24 24"><path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm12-2v8l6-4-6-4z"/></svg>`;
  const SVG_HEART = `<svg viewBox="0 0 24 24"><path d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  function renderPlaylistList() {
    el.plList.innerHTML = "";
    el.plEmpty.classList.toggle("hidden", state.playlists.length > 0);
    for (const p of state.playlists) {
      const b = document.createElement("button");
      b.className = "row";
      const isFav = p.name === FAV;
      b.innerHTML = `<div class="ic ${isFav ? "fav" : "pl"}">${isFav ? SVG_HEART : SVG_PL}</div>
        <div class="t"><div class="n"></div><div class="s"></div></div>`;
      b.querySelector(".n").textContent = p.name;
      b.querySelector(".s").textContent = `${p.items.length}곡` + (state.source.type === "playlist" && state.source.name === p.name ? " · 재생 중" : "");
      b.onclick = () => openPlaylist(p.name);
      el.plList.appendChild(b);
    }
  }

  // ── 플레이리스트: 상세 화면 ─────────────────────────────────
  function openPlaylist(name) {
    state.openPl = name; state.plEditing = false;
    show(el.sPl);
    el.hdrSub.textContent = "";
    renderPlaylistDetail();
  }
  function closePlaylist() {
    state.openPl = null; state.plEditing = false;
    show(el.sTracks);
    el.hdrSub.textContent = state.folder ? state.folder.name : "";
    showTab("pl");
  }
  const SVG_UP = `<svg viewBox="0 0 24 24"><path d="m7.41 15.41 4.59-4.58 4.59 4.58L18 14l-6-6-6 6z"/></svg>`;
  const SVG_DOWN = `<svg viewBox="0 0 24 24"><path d="m7.41 8.59 4.59 4.58 4.59-4.58L18 10l-6 6-6-6z"/></svg>`;
  const SVG_X = `<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  function renderPlaylistDetail() {
    const p = getPl(state.openPl);
    if (!p) { closePlaylist(); return; }
    el.plTitle.textContent = p.name;
    el.plCount.textContent = p.items.length ? `${p.items.length}곡` : "";
    el.plTracksEmpty.classList.toggle("hidden", p.items.length > 0);
    el.sPl.classList.toggle("editing", state.plEditing);
    el.btnPlEdit.classList.toggle("on", state.plEditing);
    el.btnPlEdit.lastChild.textContent = state.plEditing ? "완료" : "편집";
    el.btnPlRename.classList.toggle("hidden", !state.plEditing);
    el.btnPlDelete.classList.toggle("hidden", !state.plEditing);
    el.btnPlPlay.disabled = el.btnPlShuffle.disabled = !p.items.length;

    el.plTracks.innerHTML = "";
    const cur = currentTrack();
    const tracks = plItemsToTracks(p);
    tracks.forEach((t, i) => {
      const inLib = state.library.some((x) => x.id === t.id);
      const row = trackRow(t, i, {
        playing: !!cur && cur.id === t.id && state.source.type === "playlist" && state.source.name === p.name,
        sub: t.folderName || (inLib ? "" : "다른 폴더의 곡"),
        onPlay: () => { if (state.plEditing) return; setQueue({ type: "playlist", name: p.name }, plItemsToTracks(p)); playIndex(i); },
      });
      const h = document.createElement("div");
      h.className = "handle";
      const mk = (svg, title, fn) => { const b = document.createElement("button"); b.innerHTML = svg; b.title = title; b.onclick = fn; return b; };
      h.appendChild(mk(SVG_UP, "위로", () => { if (i > 0) { [p.items[i - 1], p.items[i]] = [p.items[i], p.items[i - 1]]; savePlaylists(); renderPlaylistDetail(); } }));
      h.appendChild(mk(SVG_DOWN, "아래로", () => { if (i < p.items.length - 1) { [p.items[i + 1], p.items[i]] = [p.items[i], p.items[i + 1]]; savePlaylists(); renderPlaylistDetail(); } }));
      h.appendChild(mk(SVG_X, "빼기", () => { removeFromPlaylist(p.name, t.id); renderPlaylistDetail(); }));
      row.appendChild(h);
      el.plTracks.appendChild(row);
    });
  }
  function playPlaylist(shuffle) {
    const p = getPl(state.openPl);
    if (!p || !p.items.length) return;
    if (state.shuffle !== shuffle) { state.shuffle = shuffle; store.set("shuffle", shuffle); el.btnShuffle.classList.toggle("active", shuffle); }
    setQueue({ type: "playlist", name: p.name }, plItemsToTracks(p));
    state.pos = 0; playCurrent();
  }
  function renamePlaylist() {
    const p = getPl(state.openPl); if (!p) return;
    const name = (prompt("새 이름", p.name) || "").trim();
    if (!name || name === p.name) return;
    if (getPl(name)) { toast("같은 이름이 이미 있어요"); return; }
    p.name = name; state.openPl = name;
    if (state.source.type === "playlist") state.source.name = name;
    savePlaylists(); renderPlaylistDetail();
  }
  function deletePlaylist() {
    const p = getPl(state.openPl); if (!p) return;
    if (!confirm(`"${p.name}" 플레이리스트를 지울까요? (곡 파일은 그대로 남아요)`)) return;
    state.playlists = state.playlists.filter((x) => x !== p);
    if (state.source.type === "playlist" && state.source.name === p.name) setQueue({ type: "library" }, state.library);
    savePlaylists(); closePlaylist();
  }

  // ── 플레이리스트에 담기 (바텀시트) ──────────────────────────
  const SVG_CHECK = `<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  function openSheet(t) {
    state.sheetTrack = t;
    el.sheetTrack.textContent = t.title;
    renderSheet();
    el.dim.classList.add("show"); el.sheet.classList.add("show");
  }
  function closeSheet() { el.dim.classList.remove("show"); el.sheet.classList.remove("show"); state.sheetTrack = null; }
  function renderSheet() {
    const t = state.sheetTrack; if (!t) return;
    el.sheetList.innerHTML = "";
    const names = [FAV, ...state.playlists.map((p) => p.name).filter((n) => n !== FAV)];
    for (const name of names) {
      const on = inPlaylist(name, t.id);
      const b = document.createElement("button");
      b.className = "row" + (on ? " on" : "");
      b.innerHTML = `<div class="chk">${SVG_CHECK}</div><div class="t"><div class="n"></div><div class="s"></div></div>`;
      b.querySelector(".n").textContent = name;
      const p = getPl(name);
      b.querySelector(".s").textContent = p ? `${p.items.length}곡` : "아직 없음 — 누르면 만들어져요";
      b.onclick = () => { if (on) removeFromPlaylist(name, t.id); else addToPlaylist(name, t); renderSheet(); updateFavUI(); toast(on ? `"${name}"에서 뺐어요` : `"${name}"에 담았어요`); };
      el.sheetList.appendChild(b);
    }
  }

  // ── ♥ 즐겨찾기 ────────────────────────────────────────────
  function toggleFav() {
    const t = currentTrack(); if (!t) return;
    if (inPlaylist(FAV, t.id)) { removeFromPlaylist(FAV, t.id); toast("즐겨찾기에서 뺐어요"); }
    else { addToPlaylist(FAV, t); toast("즐겨찾기에 담았어요"); }
    updateFavUI();
    if (state.openPl === FAV) renderPlaylistDetail();
  }
  function updateFavUI() {
    const t = currentTrack();
    const on = !!t && inPlaylist(FAV, t.id);
    el.icFavOn.classList.toggle("hidden", !on);
    el.icFavOff.classList.toggle("hidden", on);
  }

  // ── 재생 순서 ──────────────────────────────────────────────
  function rebuildOrder() {
    const curId = currentTrack() && currentTrack().id;
    state.order = state.tracks.map((_, i) => i);
    if (state.shuffle) {
      for (let i = state.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
      }
      // 지금 듣는 곡은 맨 앞으로
      if (curId) {
        const k = state.order.findIndex((i) => state.tracks[i].id === curId);
        if (k > 0) { const [x] = state.order.splice(k, 1); state.order.unshift(x); }
      }
    }
    state.pos = curId ? state.order.findIndex((i) => state.tracks[i].id === curId) : -1;
  }
  const currentTrack = () => (state.pos >= 0 && state.pos < state.order.length) ? state.tracks[state.order[state.pos]] : null;

  // ── 파일 받아오기 ──────────────────────────────────────────
  async function fetchTrackUrl(track) {
    if (state.blobUrls.has(track.id)) return state.blobUrls.get(track.id);
    const res = await driveFetch(`/files/${track.id}`, { alt: "media", supportsAllDrives: "true" });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    state.blobUrls.set(track.id, url);
    // 메모리 아끼기: 최근 6곡만 들고 있음
    if (state.blobUrls.size > 6) {
      const oldest = state.blobUrls.keys().next().value;
      if (oldest !== track.id && !(currentTrack() && oldest === currentTrack().id)) {
        URL.revokeObjectURL(state.blobUrls.get(oldest)); state.blobUrls.delete(oldest);
      }
    }
    return url;
  }

  function prefetchNext() {
    const n = nextPos(false);
    if (n == null) return;
    const t = state.tracks[state.order[n]];
    if (t && !state.blobUrls.has(t.id)) fetchTrackUrl(t).catch(() => {});
  }

  // ── 재생 제어 ──────────────────────────────────────────────
  function playIndex(trackIndex) {
    const p = state.order.indexOf(trackIndex);
    if (p < 0) return;
    state.pos = p;
    return playCurrent();
  }

  async function playCurrent(startAt = 0) {
    const t = currentTrack();
    if (!t) return;
    el.player.classList.add("show");
    showNowPlaying(t);
    markPlayingRow();
    el.npLoading.classList.remove("hidden");
    state.loadingId = t.id;
    try {
      const url = await fetchTrackUrl(t);
      if (state.loadingId !== t.id) return; // 그새 다른 곡을 눌렀음
      el.audio.src = url;
      if (startAt) el.audio.currentTime = startAt;
      await el.audio.play();
      store.set("last:" + state.folder.id, { id: t.id });
      updateMediaSession(t);
      prefetchNext();
    } catch (e) {
      el.npSub.textContent = "재생 실패: " + e.message;
    } finally {
      if (state.loadingId === t.id) el.npLoading.classList.add("hidden");
    }
  }

  function showNowPlaying(t) {
    el.npTitle.textContent = t.title;
    el.npSub.textContent = state.source.type === "playlist" ? `♪ ${state.source.name}` : (t.folderName || state.folder.name);
    document.title = t.title + " · Drive Music";
  }

  function nextPos(wrap = true) {
    if (!state.order.length) return null;
    if (state.pos + 1 < state.order.length) return state.pos + 1;
    return (wrap || state.repeat === "all") ? 0 : null;
  }

  function next() {
    const n = nextPos(state.repeat === "all");
    if (n == null) { el.audio.pause(); return; }
    state.pos = n; playCurrent();
  }
  function prev() {
    if (el.audio.currentTime > 3) { el.audio.currentTime = 0; return; }
    if (!state.order.length) return;
    state.pos = state.pos > 0 ? state.pos - 1 : state.order.length - 1;
    playCurrent();
  }
  function togglePlay() {
    if (!currentTrack()) { if (state.tracks.length) playIndex(state.order[0]); return; }
    if (!el.audio.src) { playCurrent(); return; }
    if (el.audio.paused) el.audio.play().catch(() => {}); else el.audio.pause();
  }
  function stopPlayback() {
    el.audio.pause(); el.audio.removeAttribute("src"); el.audio.load();
    state.pos = -1; state.tracks = []; state.order = []; state.source = { type: "library" };
    el.player.classList.remove("show");
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    store.set("shuffle", state.shuffle);
    el.btnShuffle.classList.toggle("active", state.shuffle);
    rebuildOrder();
  }
  function cycleRepeat() {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    store.set("repeat", state.repeat);
    applyRepeatUI();
  }
  function applyRepeatUI() {
    el.btnRepeat.classList.toggle("active", state.repeat !== "off");
    el.icRepeat.classList.toggle("hidden", state.repeat === "one");
    el.icRepeat1.classList.toggle("hidden", state.repeat !== "one");
    el.audio.loop = state.repeat === "one";
  }

  // ── 잠금화면 / 이어폰 버튼 (Media Session) ──────────────────
  function updateMediaSession(t) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.folderName, album: state.folder.name });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    set("play", () => el.audio.play());
    set("pause", () => el.audio.pause());
    set("previoustrack", prev);
    set("nexttrack", next);
    set("seekto", (d) => { if (d.seekTime != null) el.audio.currentTime = d.seekTime; });
    set("seekbackward", () => { el.audio.currentTime = Math.max(0, el.audio.currentTime - 10); });
    set("seekforward", () => { el.audio.currentTime = Math.min(el.audio.duration || 0, el.audio.currentTime + 10); });
  }

  // ── 오디오 이벤트 ──────────────────────────────────────────
  el.audio.addEventListener("play", () => { el.icPlay.classList.add("hidden"); el.icPause.classList.remove("hidden"); });
  el.audio.addEventListener("pause", () => { el.icPlay.classList.remove("hidden"); el.icPause.classList.add("hidden"); });
  el.audio.addEventListener("ended", () => { if (state.repeat !== "one") next(); });
  el.audio.addEventListener("timeupdate", () => {
    if (state.seeking) return;
    const d = el.audio.duration || 0, c = el.audio.currentTime || 0;
    el.tCur.textContent = fmtTime(c);
    el.tDur.textContent = fmtTime(d);
    const p = d ? (c / d) * 1000 : 0;
    el.seek.value = p; el.seek.style.setProperty("--p", (p / 10) + "%");
  });
  el.audio.addEventListener("durationchange", () => { el.tDur.textContent = fmtTime(el.audio.duration); });
  el.audio.addEventListener("error", () => { el.npSub.textContent = "이 파일은 브라우저가 재생하지 못해요 (형식 문제). 다음 곡으로 넘어갑니다."; setTimeout(next, 1500); });

  el.seek.addEventListener("input", () => {
    state.seeking = true;
    const d = el.audio.duration || 0;
    el.tCur.textContent = fmtTime((el.seek.value / 1000) * d);
    el.seek.style.setProperty("--p", (el.seek.value / 10) + "%");
  });
  el.seek.addEventListener("change", () => {
    const d = el.audio.duration || 0;
    el.audio.currentTime = (el.seek.value / 1000) * d;
    state.seeking = false;
  });

  // ── 버튼 ──────────────────────────────────────────────────
  el.btnLogin.onclick = login;
  el.btnLogout.onclick = logout;
  el.btnFolder.onclick = showFolderPicker;
  el.btnRefresh.onclick = () => state.folder && openFolder(state.folder);
  el.btnFolderSearch.onclick = searchFolders;
  el.folderQ.addEventListener("keydown", (e) => { if (e.key === "Enter") searchFolders(); });
  el.btnPlay.onclick = togglePlay;
  el.btnNext.onclick = next;
  el.btnPrev.onclick = prev;
  el.btnShuffle.onclick = toggleShuffle;
  el.btnRepeat.onclick = cycleRepeat;
  el.btnFav.onclick = toggleFav;

  // 플레이리스트
  el.btnBack.onclick = closePlaylist;
  el.tabLib.onclick = () => showTab("lib");
  el.tabPl.onclick = () => showTab("pl");
  el.btnPlNew.onclick = () => { if (createPlaylist(el.plNewName.value)) { el.plNewName.value = ""; renderPlaylistList(); } };
  el.plNewName.addEventListener("keydown", (e) => { if (e.key === "Enter") el.btnPlNew.click(); });
  el.btnPlPlay.onclick = () => playPlaylist(false);
  el.btnPlShuffle.onclick = () => playPlaylist(true);
  el.btnPlEdit.onclick = () => { state.plEditing = !state.plEditing; renderPlaylistDetail(); };
  el.btnPlRename.onclick = renamePlaylist;
  el.btnPlDelete.onclick = deletePlaylist;
  el.dim.onclick = closeSheet;
  el.btnSheetNew.onclick = () => {
    const name = el.sheetNewName.value.trim(); if (!name || !state.sheetTrack) return;
    addToPlaylist(name, state.sheetTrack); el.sheetNewName.value = ""; renderSheet(); updateFavUI(); toast(`"${name}"에 담았어요`);
  };
  el.sheetNewName.addEventListener("keydown", (e) => { if (e.key === "Enter") el.btnSheetNew.click(); });

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.code === "ArrowRight" && e.shiftKey) next();
    else if (e.code === "ArrowLeft" && e.shiftKey) prev();
    else if (e.code === "ArrowRight") el.audio.currentTime += 10;
    else if (e.code === "ArrowLeft") el.audio.currentTime -= 10;
  });

  // ── 시작 ──────────────────────────────────────────────────
  (function init() {
    state.shuffle = !!store.get("shuffle", false);
    state.repeat = store.get("repeat", "off");
    el.btnShuffle.classList.toggle("active", state.shuffle);
    applyRepeatUI();

    try { state.token = JSON.parse(sessionStorage.getItem("dm:token") || "null"); } catch {}
    if (tokenValid()) {
      // 같은 탭에서 새로고침한 경우 — 로그인 창 없이 바로 이어감
      const tick = setInterval(() => { if (ensureTokenClient()) { clearInterval(tick); afterLogin().catch((e) => { show(el.sLogin); notice(e.message); }); } }, 100);
      setTimeout(() => clearInterval(tick), 8000);
    } else {
      show(el.sLogin);
      if (location.protocol === "file:") notice("파일을 더블클릭으로 연 상태예요. 구글 로그인은 이렇게 열면 안 되고, README의 2번처럼 서버로 띄워서 열어야 합니다.");
    }
  })();
})();
