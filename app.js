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
  const LIB_FILE = "drive-music-library.md";     // 드라이브에 저장되는 곡 태그(보관함) 파일
  const TAG_WORKERS = 4;                         // 태그는 동시에 4곡씩만 읽음
  const LANGS = ["한국어", "중국어", "영어", "일본어", "기타"];   // 언어 태그 값 (이 순서로 보여줌)
  const AUDIO_EXT = ["mp3", "m4a", "flac", "wav", "ogg", "aac", "opus", "wma", "aiff"];

  // ── 화면 요소 ──────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    hdrSub: $("hdr-sub"),
    btnBack: $("btn-back"), btnFolder: $("btn-folder"), btnRefresh: $("btn-refresh"), btnLogout: $("btn-logout"),
    sLogin: $("s-login"), sFolder: $("s-folder"), sTracks: $("s-tracks"), sPl: $("s-pl"), sTags: $("s-tags"),
    tagKinds: $("tag-kinds"), tagsQ: $("tags-q"), tagList: $("tag-list"), tagsCount: $("tags-count"),
    tabLib: $("tab-lib"), tabPl: $("tab-pl"), viewLib: $("view-lib"), viewPl: $("view-pl"),
    plList: $("pl-list"), plEmpty: $("pl-empty"), plSync: $("pl-sync"), plNewName: $("pl-new-name"), btnPlNew: $("btn-pl-new"),
    plTitle: $("pl-title"), plCount: $("pl-count"), plTracks: $("pl-tracks"), plTracksEmpty: $("pl-tracks-empty"),
    btnPlPlay: $("btn-pl-play"), btnPlShuffle: $("btn-pl-shuffle"), btnPlEdit: $("btn-pl-edit"),
    btnPlRename: $("btn-pl-rename"), btnPlDelete: $("btn-pl-delete"),
    dim: $("dim"), sheet: $("sheet"), sheetTrack: $("sheet-track"), sheetList: $("sheet-list"),
    sheetNewName: $("sheet-new-name"), btnSheetNew: $("btn-sheet-new"), toast: $("toast"),
    btnFav: $("btn-fav"), icFavOff: $("ic-fav-off"), icFavOn: $("ic-fav-on"),
    btnLogin: $("btn-login"), loginNotice: $("login-notice"),
    folderQ: $("folder-q"), btnFolderSearch: $("btn-folder-search"), folderHint: $("folder-hint"),
    folderList: $("folder-list"), folderEmpty: $("folder-empty"),
    tracksTitle: $("tracks-title"), tracksCount: $("tracks-count"), tagProgress: $("tag-progress"),
    trackList: $("track-list"), tracksEmpty: $("tracks-empty"),
    libQ: $("lib-q"), searchEmpty: $("search-empty"),
    libKinds: $("lib-kinds"), libGroups: $("lib-groups"), groupList: $("group-list"),
    groupHead: $("group-head"), groupTitle: $("group-title"), groupSub: $("group-sub"),
    btnGroupBack: $("btn-group-back"), btnGroupPlay: $("btn-group-play"),
    libPlaybar: $("lib-playbar"), btnLibPlay: $("btn-lib-play"), btnLibShuffle: $("btn-lib-shuffle"),
    btnGroupEdit: $("btn-group-edit"), btnLibMenu: $("btn-lib-menu"), btnMerge: $("btn-merge"),
    msheet: $("msheet"), msheetTitle: $("msheet-title"), msheetSub: $("msheet-sub"), msheetBody: $("msheet-body"),
    msheetBtns: $("msheet-btns"), msheetCancel: $("msheet-cancel"), msheetOk: $("msheet-ok"),
    player: $("player"), npTitle: $("np-title"), npSub: $("np-sub"), npLoading: $("np-loading"),
    npArt: $("np-art"), npArtImg: $("np-art-img"),
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
    library: [],          // 폴더에서 긁어온 전체 곡 [{ id, name, title, size, mimeType, folderName, tags }]
    tagDb: new Map(),     // 파일ID -> { tags, folderName } (drive-music-library.md 내용, 모든 폴더)
    libFileId: null,      // 드라이브에 있는 보관함 파일 id
    libDirty: false, libSaving: false, libAgain: false, libSaveTimer: null,
    groupEditing: false, groupChecked: new Set(),   // 이름 목록 "편집"(합치기) 중 / 체크한 묶음 key
    scanId: 0,            // 태그 읽기 차례 번호 — 폴더를 바꾸면 이전 읽기는 멈춤
    openSeq: 0,           // 폴더 열기 차례 번호 — 그새 다른 폴더를 열면 늦게 온 결과는 버림
    arts: new Map(),      // 파일ID -> 표지 그림 objectURL (메모리에만)
    tracks: [],           // 지금 "재생 중인 출처"의 곡들 (전체 곡 또는 플레이리스트 하나)
    source: { type: "library" },   // { type:"library" } | { type:"playlist", name } | { type:"group", kind, key, name } | { type:"view", name }(검색 결과·분류 전체)
    libView: { kind: "songs", group: null },   // 보관함에서 보던 분류(곡/artist/album/composer/genre)와 묶음 key
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
  // 제목·아티스트 글자 모양으로 언어 짐작: 한글 → 한국어, 가나 → 일본어, 한자만 → 중국어, 로마자 → 영어, 그 밖 → 기타
  function detectLang(...parts) {
    const s = parts.filter(Boolean).join(" ");
    if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(s)) return "한국어";
    if (/[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/.test(s)) return "일본어";
    if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(s)) return "중국어";
    if (/[A-Za-z]/.test(s)) return "영어";
    return "기타";
  }
  // 화면에 보이는 제목·부제 (태그가 있으면 태그, 없으면 파일 이름·크기)
  const dispTitle = (t) => (t.tags && t.tags.title) || t.title;
  const tagSub = (t) => {
    const g = t.tags || {};
    const album = g.album && g.album !== t.folderName ? g.album : "";   // 앨범이 폴더명뿐이면(태그 없음) 안 씀
    return [g.artist, album].filter(Boolean).join(" · ");
  };
  const isAudioName = (n) => AUDIO_EXT.includes((n.split(".").pop() || "").toLowerCase());
  const show = (screen) => {
    for (const s of [el.sLogin, el.sFolder, el.sTracks, el.sPl, el.sTags]) s.classList.toggle("show", s === screen);
    const signedIn = screen !== el.sLogin;
    const sub = screen === el.sPl || screen === el.sTags;   // 뒤로 버튼이 있는 하위 화면
    el.btnBack.classList.toggle("hidden", !sub);
    el.btnFolder.classList.toggle("hidden", !signedIn || sub);
    el.btnRefresh.classList.toggle("hidden", screen !== el.sTracks);
    el.btnLogout.classList.toggle("hidden", !signedIn || sub);
    window.scrollTo(0, 0);
  };
  let toastTimer = null;
  // action = { label, fn } 이면 오른쪽에 버튼 하나(5초 동안)
  const toast = (msg, action) => {
    el.toast.textContent = msg;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => { el.toast.classList.remove("show"); action.fn(); };
      el.toast.appendChild(b);
    }
    el.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove("show"), action ? 5000 : 1800);
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
    state.scanId++; state.tagDb = new Map(); state.libFileId = null; tagDbLoading = null; store.del("library"); store.del("libundo");
    for (const k of store.get("libkeys", [])) store.del("lib:" + k);
    store.del("libkeys");
    store.del("folder"); store.del("queue"); state.folder = null;   // 다음 로그인은 기본 폴더(Music) 찾기부터
    show(el.sLogin);
    notice("로그아웃했어요.", true);
  }

  async function afterLogin() {
    loadPlaylists().catch((e) => { el.plSync.textContent = "불러오기 실패"; console.warn(e); });
    const saved = store.get("folder", null);
    if (saved && saved.id) await openFolder(saved);
    else await openDefaultFolder();
  }

  // 기본 폴더(config.js의 DEFAULT_FOLDER_NAME, 보통 "Music")를 딱 한 번 찾아서 열기. 없으면 그때만 폴더 고르기 화면
  async function openDefaultFolder() {
    const name = (CFG.DEFAULT_FOLDER_NAME || "").trim();
    if (name) {
      try {
        const hit = await findFolderByName(name);
        if (hit) return openFolder({ id: hit.id, name: hit.name }, { fromDefault: true });
      } catch (e) { console.warn("기본 폴더 찾기 실패", e); }
      return showFolderPicker(`"${name}" 폴더를 못 찾았어요. 음악 폴더 이름을 입력해 찾아보세요.`);
    }
    return showFolderPicker();
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
      const err = new Error(msg); err.status = res.status;
      throw err;
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

  // 한 페이지만 가져오기 (폴더 찾기용 — 폴더가 아무리 많아도 한 번만 물어봄)
  async function listPage(q, fields, orderBy, pageSize) {
    const res = await driveFetch("/files", {
      q, fields: `files(${fields})`, pageSize: String(pageSize), orderBy,
      supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    });
    return (await res.json()).files || [];
  }
  const FOLDER_Q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";

  // 이름으로 찾으면 50개까지(이름 순), 빈 칸이면 최근 수정된 폴더 20개만
  async function listFolders(query) {
    if (!query) return listPage(FOLDER_Q, "id, name, modifiedTime, parents", "modifiedTime desc", 20);
    return listPage(`${FOLDER_Q} and name contains '${esc(query)}'`, "id, name, modifiedTime, parents", "name", 50);
  }
  // 이름이 딱 그것(대소문자 무시)인 폴더 — 여러 개면 가장 최근 수정된 것
  //  드라이브의 name = 비교는 대소문자를 가릴 수 있어서 Music·music·MUSIC 같은 흔한 표기를 한 번에 물어봄
  async function findFolderByName(name) {
    const spellings = [...new Set([name, name.toLowerCase(), name.toUpperCase(), name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()])];
    const nameQ = spellings.map((n) => `name = '${esc(n)}'`).join(" or ");
    const list = await listPage(`${FOLDER_Q} and (${nameQ})`, "id, name, modifiedTime", "modifiedTime desc", 5);
    return list.find((f) => f.name.toLowerCase() === name.toLowerCase()) || null;
  }
  // 기억된 폴더가 아직 있는지 (지워졌거나 휴지통·권한 없음이면 gone)
  async function checkFolder(folder) {
    try {
      const res = await driveFetch(`/files/${folder.id}`, { fields: "id, name, trashed", supportsAllDrives: "true" });
      const f = await res.json();
      if (f.trashed) { const e = new Error("휴지통에 있는 폴더"); e.gone = true; throw e; }
      return f;
    } catch (e) {
      if (e.status === 404 || e.status === 403) e.gone = true;
      throw e;
    }
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
  function showFolderPicker(msg = "") {
    show(el.sFolder);
    el.hdrSub.textContent = "";
    el.folderList.innerHTML = "";
    el.folderEmpty.classList.add("hidden");
    el.folderHint.textContent = (typeof msg === "string" && msg) || "폴더 이름을 입력하세요. 비우고 찾으면 최근 폴더 20개";
    el.folderQ.focus();
  }

  let folderSeq = 0;   // 찾기를 연달아 누르면 마지막 것만 보여줌
  async function searchFolders() {
    const my = ++folderSeq;
    el.folderList.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    el.folderEmpty.classList.add("hidden");
    try {
      const query = el.folderQ.value.trim();
      const folders = await listFolders(query);
      if (my !== folderSeq) return;
      el.folderList.innerHTML = "";
      el.folderHint.textContent = query ? `"${query}" 들어간 폴더${folders.length >= 50 ? " (앞의 50개만)" : ""}` : "최근 수정된 폴더 20개";
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
      if (my !== folderSeq) return;
      el.folderList.innerHTML = `<div class="notice">폴더를 못 불러왔어요: ${e.message}</div>`;
    }
  }

  // ── 재생목록 화면 ──────────────────────────────────────────
  async function openFolder(folder, { retag = false, dropEdits = false, fromDefault = false } = {}) {
    state.scanId++;   // 읽던 태그는 멈춤
    setTagProgress("");
    if (!state.folder || state.folder.id !== folder.id) el.libQ.value = "";   // 다른 폴더로 가면 검색어 비움 (새로고침은 유지)
    state.folder = folder;
    store.set("folder", folder);
    show(el.sTracks);
    el.hdrSub.textContent = folder.name;
    el.tracksTitle.textContent = folder.name;
    el.tracksCount.textContent = "";
    el.trackList.innerHTML = `<div class="empty"><span class="spinner"></span> 음악 찾는 중…</div>`;
    el.trackList.classList.remove("hidden"); el.libGroups.classList.add("hidden");   // 분류 화면이어도 "찾는 중"은 보이게
    el.tracksEmpty.classList.add("hidden");
    el.searchEmpty.classList.add("hidden");
    showTab("lib");
    const my = ++state.openSeq;
    const tagP = loadTagDb();   // 이 기기에 남은 태그 복사본은 여기서 바로 들어옴
    const cached = readLibCache(folder.id);
    if (cached) setLibrary(cached);   // 지난번 목록으로 먼저 보여줌
    try {
      const [tracks] = await Promise.all([listAudioIn(folder), tagP, checkFolder(folder)]);
      if (my !== state.openSeq) return;   // 그새 다른 폴더를 열었음
      writeLibCache(folder.id, tracks);
      if (!cached) setLibrary(tracks);
      else if (libChanged(cached, tracks)) refreshLibrary(tracks);
      else { attachTags(); renderLib(); }   // 목록은 같고 드라이브의 태그만 새로 왔을 수 있음
      const cur = currentTrack();
      if (cur) { const e = state.tagDb.get(cur.id); if (e) cur.tags = e.tags; showNowPlayingText(cur); }   // 하단 플레이어 글자도 태그로
      scanTags(retag, dropEdits);
    } catch (e) {
      if (my !== state.openSeq) return;
      if (e.gone) {   // 기억된 폴더가 지워졌거나 권한이 없음 → 기억을 지우고 기본 폴더부터 다시
        store.del("folder"); store.del("lib:" + folder.id); state.folder = null;
        toast(`"${folder.name}" 폴더를 열 수 없어서 다시 찾아요`);
        if (!retag && !fromDefault) return openDefaultFolder();   // 기본 폴더에서 온 거면 또 찾지 않음(반복 방지)
        return showFolderPicker(`"${folder.name}" 폴더를 열 수 없어요. 다른 폴더를 찾아보세요.`);
      }
      if (cached) toast("목록을 새로 못 읽었어요 — 지난번 목록을 보여줘요");
      else el.trackList.innerHTML = `<div class="notice">목록을 못 불러왔어요: ${e.message}</div>`;
    }
  }

  // 곡 목록 캐시: localStorage "dm:lib:<폴더ID>". 파일 정보만(태그는 보관함 tagDb에 따로 있어서 겹치지 않음). 최근 5개 폴더만
  const LIB_CACHE_MAX = 5;
  function readLibCache(folderId) {
    const c = store.get("lib:" + folderId, null);
    if (!Array.isArray(c) || !c.length) return null;
    return c.map(([id, name, size, mimeType, folderName]) => ({ id, name, title: stripExt(name), size, mimeType, folderName }));
  }
  function writeLibCache(folderId, tracks) {
    store.set("lib:" + folderId, tracks.map((t) => [t.id, t.name, t.size, t.mimeType, t.folderName]));
    const keys = store.get("libkeys", []).filter((k) => k !== folderId);
    keys.unshift(folderId);
    for (const old of keys.splice(LIB_CACHE_MAX)) store.del("lib:" + old);
    store.set("libkeys", keys);
  }
  const libSig = (tracks) => tracks.map((t) => `${t.id}\u0001${t.name}\u0001${t.size}\u0001${t.folderName}`).join("\n");
  const libChanged = (a, b) => libSig(a) !== libSig(b);
  // 듣던 곡·받아둔 파일은 그대로 두고 목록만 바꿈 (캐시로 먼저 그린 뒤 드라이브 목록이 달랐을 때)
  function refreshLibrary(tracks) {
    const keep = new Set(tracks.map((t) => t.id));
    for (const [id, u] of state.blobUrls) if (!keep.has(id)) { URL.revokeObjectURL(u); state.blobUrls.delete(id); }
    const cur = currentTrack();
    state.library = tracks;
    attachTags();
    if (state.source.type === "library") {
      state.tracks = tracks; state.pos = -1;
      rebuildOrder();
      if (cur) { const i = tracks.findIndex((t) => t.id === cur.id); if (i >= 0) state.pos = state.order.indexOf(i); }
    }
    el.tracksEmpty.classList.toggle("hidden", tracks.length > 0);
    renderLib();
  }

  function setLibrary(tracks) {
    // 이전에 받아둔 파일은 비움
    for (const u of state.blobUrls.values()) URL.revokeObjectURL(u);
    state.blobUrls.clear();
    state.library = tracks;
    attachTags();
    el.tracksCount.textContent = tracks.length ? `${tracks.length}곡` : "";
    el.tracksEmpty.classList.toggle("hidden", tracks.length > 0);

    // 처음 열 때(아직 큐가 없음): 지난번 듣던 큐(출처·순서)가 이 폴더 것이면 그대로 되살림
    if (!state.tracks.length && restoreQueue(tracks)) {
      const cur = currentTrack();
      if (cur) { showNowPlaying(cur); el.player.classList.add("show"); }
    }
    // 출처를 전체 곡으로 — 플레이리스트를 듣던 중이면 그대로 둠
    else if (state.source.type === "library" || !state.tracks.length) {
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
    renderLib();
  }

  // 출처(전체 곡 / 플레이리스트)를 바꿔서 재생 큐를 새로 만듦
  function setQueue(source, tracks) {
    state.source = source;
    state.tracks = tracks;
    state.pos = -1;
    rebuildOrder();
    saveQueue();
  }

  // 지난번 듣던 큐 기억: 폴더, 출처, 곡 id 순서, 섞인 순서 (localStorage "dm:queue"). 지금 곡은 "dm:last:<폴더>"
  function saveQueue() {
    if (!state.folder || !state.tracks.length) return;
    store.set("queue", { folderId: state.folder.id, source: state.source, ids: state.tracks.map((t) => t.id), order: state.order });
  }
  function restoreQueue(library) {
    const q = store.get("queue", null);
    if (!q || !state.folder || q.folderId !== state.folder.id || !Array.isArray(q.ids) || !q.source) return false;
    const byId = new Map(library.map((t) => [t.id, t]));
    const tracks = q.ids.map((id) => byId.get(id) || otherFolderTrack(id)).filter(Boolean);
    if (!tracks.length) return false;
    state.source = q.source;
    state.tracks = tracks;
    // 곡이 그대로면 섞였던 순서까지, 달라졌으면 지금 섞기 설정으로 새로
    const okOrder = Array.isArray(q.order) && q.order.length === tracks.length && tracks.length === q.ids.length &&
      [...q.order].sort((a, b) => a - b).every((x, i) => x === i);
    const wasShuffled = okOrder && q.order.some((x, i) => x !== i);
    if (okOrder && wasShuffled === !!state.shuffle) state.order = q.order.slice();   // 섞기 설정이 그때와 같으면 그 순서 그대로
    else { state.pos = -1; rebuildOrder(); }
    const last = store.get("last:" + state.folder.id, null);
    const i = last ? tracks.findIndex((t) => t.id === last.id) : -1;
    state.pos = i >= 0 ? state.order.indexOf(i) : 0;
    return true;
  }
  // 플레이리스트에 담긴 다른 폴더 곡: 보관함(tagDb)에 있으면 그 정보로
  function otherFolderTrack(id) {
    const e = state.tagDb.get(id);
    if (!e) return null;
    return { id, name: e.tags.title, title: e.tags.title, size: 0, mimeType: "audio/", folderName: e.folderName, tags: e.tags };
  }

  // 곡 한 줄 (전체 곡·플레이리스트·바텀시트가 같이 씀)
  const SVG_NOTE = `<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`;
  const SVG_PLUS = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  const SVG_MORE = `<svg viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`;
  function trackRow(t, i, { playing, onPlay, onAdd, onMore, sub }) {
    const b = document.createElement("div");
    b.className = "row" + (playing ? " playing" : "");
    b.dataset.id = t.id;
    b.innerHTML = `<span class="num">${i + 1}</span>
      <div class="ic">${SVG_NOTE}</div>
      <button class="t" style="text-align:left;flex:1;min-width:0;padding:0"><div class="n"></div><div class="s"></div></button>`;
    b.querySelector(".n").textContent = dispTitle(t);
    b.querySelector(".s").textContent = sub;
    b.querySelector(".t").onclick = onPlay;
    if (onAdd) {
      const a = document.createElement("button");
      a.className = "act add"; a.title = "플레이리스트에 담기"; a.innerHTML = SVG_PLUS; a.onclick = onAdd;
      b.appendChild(a);
    }
    if (onMore) {
      const m = document.createElement("button");
      m.className = "act more"; m.title = "더 보기 (태그 편집)"; m.innerHTML = SVG_MORE; m.onclick = onMore;
      b.appendChild(m);
    }
    return b;
  }

  // 검색: 보기만 거름. 번호(i)는 전체 곡 기준 그대로라 눌러도 전체 곡 큐에서 재생됨
  const norm = (s) => (s || "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
  const matchTrack = (t, q) => { const g = t.tags || {}; return [dispTitle(t), t.title, t.folderName, g.artist, g.album].some((v) => norm(v).includes(q)); };
  function renderTracks() {
    el.trackList.innerHTML = "";
    const cur = currentTrack();
    const q = norm(el.libQ.value);
    let lastFolder = null, shown = 0;
    state.library.forEach((t, i) => {
      if (q && !matchTrack(t, q)) return;
      shown++;
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
        sub: tagSub(t) || fmtSize(t.size),
        onPlay: () => { if (state.source.type !== "library") setQueue({ type: "library" }, state.library); playIndex(i); },
        onAdd: () => openSheet(t),
        onMore: () => openTrackMenu(t),
      }));
    });
    const n = state.library.length;
    el.tracksCount.textContent = !n ? "" : q ? `${shown} / ${n}곡` : `${n}곡`;
    el.searchEmpty.classList.toggle("hidden", !(q && n && !shown));
  }

  function markPlayingRow() {
    const cur = currentTrack();
    for (const r of document.querySelectorAll("#track-list .row, #pl-tracks .row, #group-list .row[data-id]")) r.classList.toggle("playing", !!cur && r.dataset.id === cur.id);
    updateFavUI();
  }

  // ── 보관함 분류: 곡 | 아티스트 | 앨범 | 작곡가 | 장르 ─────────
  //  "곡"은 위의 renderTracks() 그대로. 나머지는 이름 목록 → 누르면 그 묶음의 곡들
  const KINDS = {
    artist:   { label: "아티스트", unit: "명", unknown: "알 수 없는 아티스트", get: (g) => g.artist },
    album:    { label: "앨범", unit: "개", unknown: "알 수 없는 앨범", get: (g) => g.album },
    composer: { label: "작곡가", unit: "명", unknown: "알 수 없는 작곡가", get: (g) => g.composer },
    genre:    { label: "장르", unit: "개", unknown: "알 수 없는 장르", get: (g) => g.genre },
    language: { label: "언어", unit: "개", unknown: "언어 없음", get: (g) => g.language },
  };
  const SVG_KIND = {
    artist: `<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
    album: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>`,
    composer: `<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    language: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z"/></svg>`,
    genre: `<svg viewBox="0 0 24 24"><path d="m21.41 11.58-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.84zM5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`,
  };
  const SVG_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  const libColl = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  const mainEl = document.querySelector("main");
  let groupsScroll = 0;   // 묶음 안으로 들어가기 전 이름 목록 스크롤 위치

  // 태그를 못 읽어 파일명·폴더명만 있는 곡 (앨범을 폴더명으로 묶지 않고 "알 수 없는 앨범"으로)
  const untagged = (t) => { const g = t.tags || {}; const e = state.tagDb.get(t.id); if (e && e.edited) return false; return !g.artist && (!g.album || g.album === t.folderName) && (!g.title || g.title === stripExt(t.name)); };
  function groupKey(kind, t) {
    const g = t.tags || {};
    if (kind === "album") return untagged(t) || !g.album ? "" : g.album + "\u0001" + (g.albumArtist || "");   // 같은 이름 다른 앨범아티스트는 따로
    return (KINDS[kind].get(g) || "").trim();
  }
  const byTrack = (a, b) => (Number(a.tags.track) || 999) - (Number(b.tags.track) || 999) || libColl.compare(dispTitle(a), dispTitle(b));
  function buildGroups(kind) {
    const map = new Map();
    for (const t of state.library) { const k = groupKey(kind, t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
    const out = [...map].map(([key, tracks]) => {
      const unknown = key === "";
      const [albumName, albumArtist] = key.split("\u0001");
      let sub = "";
      if (kind === "album" && !unknown) {
        const artists = new Set(tracks.map((t) => t.tags.artist).filter(Boolean));
        sub = albumArtist || (artists.size === 1 ? [...artists][0] : artists.size > 1 ? "여러 아티스트" : "");
      }
      // 앨범 안: 트랙 번호 순 / 나머지: 앨범 → 트랙 순
      tracks.sort(kind === "album" ? byTrack : (a, b) => libColl.compare(a.tags.album || "", b.tags.album || "") || byTrack(a, b));
      return { kind, key, name: unknown ? KINDS[kind].unknown : kind === "album" ? albumName : key, sub, unknown, tracks };
    });
    const langIdx = (g) => (kind === "language" ? (LANGS.indexOf(g.name) + 1 || 99) : 0);   // 언어는 정해진 순서
    out.sort((a, b) => (a.unknown - b.unknown) || langIdx(a) - langIdx(b) || libColl.compare(a.name, b.name) || libColl.compare(a.sub, b.sub));   // 알 수 없음은 맨 아래
    return out;
  }

  const saveLibView = () => store.set("libview", state.libView);
  function setLibView(kind, group = null) {
    if (kind !== state.libView.kind || group != null) { state.groupEditing = false; state.groupChecked.clear(); }
    state.libView = { kind, group };
    el.libQ.value = "";
    saveLibView();
    renderLib();
  }

  function renderLib() {
    const v = state.libView;
    for (const b of el.libKinds.querySelectorAll("button")) b.classList.toggle("on", b.dataset.kind === v.kind);
    const songs = v.kind === "songs" || !KINDS[v.kind];
    el.trackList.classList.toggle("hidden", !songs);
    el.libGroups.classList.toggle("hidden", songs);
    el.btnGroupEdit.classList.add("hidden"); el.btnMerge.classList.add("hidden"); el.libGroups.classList.remove("gediting");
    placePlaybar(songs);
    if (songs) {
      el.libQ.placeholder = "곡 찾기 (제목·가수·앨범·폴더)";
      renderTracks();
      return;
    }
    const groups = buildGroups(v.kind);
    const g = v.group != null ? groups.find((x) => x.key === v.group) : null;
    if (v.group != null && !g) { v.group = null; saveLibView(); }   // 다른 폴더라 그 묶음이 없음
    if (g) renderGroupDetail(g); else renderGroupNames(groups);
  }

  const SVG_PEN = `<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
  const SVG_CHECK2 = `<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const canDrag = window.matchMedia("(hover: hover) and (pointer: fine)").matches;   // 마우스일 때만 끌어다 합치기
  let dragKey = null;
  function renderGroupNames(groups) {
    const k = KINDS[state.libView.kind];
    const editing = state.groupEditing;
    el.libQ.placeholder = `${k.label} 이름으로 찾기`;
    el.groupHead.classList.add("hidden");
    el.btnGroupEdit.classList.toggle("hidden", !groups.length);
    el.btnGroupEdit.classList.toggle("on", editing);
    el.btnGroupEdit.textContent = editing ? "완료" : "편집";
    el.libGroups.classList.toggle("gediting", editing);
    for (const key of [...state.groupChecked]) if (!groups.some((g) => g.key === key)) state.groupChecked.delete(key);
    const q = norm(el.libQ.value);
    const shown = q ? groups.filter((g) => norm(g.name).includes(q) || norm(g.sub).includes(q)) : groups;
    el.groupList.innerHTML = "";
    for (const g of shown) {
      const b = document.createElement("div");
      b.className = "row" + (editing && state.groupChecked.has(g.key) ? " on" : "");
      b.innerHTML = `<div class="gchk">${SVG_CHECK2}</div><div class="ic grp${g.unknown ? " unknown" : ""}">${SVG_KIND[g.kind]}</div>
        <button class="t" style="text-align:left;flex:1;min-width:0;padding:0"><div class="n"></div><div class="s"></div></button>`;
      b.querySelector(".n").textContent = g.name;
      b.querySelector(".s").textContent = [g.sub, `${g.tracks.length}곡`].filter(Boolean).join(" · ");
      let pressTimer = null, pressed = false;
      b.querySelector(".t").onclick = () => {
        if (pressed) { pressed = false; return; }
        if (editing) {   // 편집 중: 체크/해제
          if (state.groupChecked.has(g.key)) state.groupChecked.delete(g.key); else state.groupChecked.add(g.key);
          renderGroupNames(groups); return;
        }
        groupsScroll = mainEl.scrollTop; setLibView(g.kind, g.key); mainEl.scrollTop = 0;
      };
      if (editing) {   // 편집 중 길게 누르면 이름 바꾸기
        b.addEventListener("pointerdown", () => { pressed = false; clearTimeout(pressTimer); pressTimer = setTimeout(() => { pressed = true; openRename(g); }, 600); });
        for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => clearTimeout(pressTimer));
        b.addEventListener("contextmenu", (e) => e.preventDefault());
      }
      const a = document.createElement("button");
      a.className = "act";
      if (editing) { a.title = "이름 바꾸기"; a.innerHTML = SVG_PEN; a.onclick = () => openRename(g); }
      else { a.title = "전부 재생"; a.innerHTML = SVG_PLAY; a.onclick = () => playGroup(g); }
      b.appendChild(a);
      if (canDrag && !editing) {   // 한 줄을 다른 줄 위에 놓으면 합치기
        b.draggable = true;
        b.addEventListener("dragstart", (e) => { dragKey = g.key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", g.name); });
        b.addEventListener("dragend", () => { dragKey = null; });
        b.addEventListener("dragover", (e) => { if (dragKey != null && dragKey !== g.key) { e.preventDefault(); b.classList.add("dropping"); } });
        b.addEventListener("dragleave", () => b.classList.remove("dropping"));
        b.addEventListener("drop", (e) => {
          e.preventDefault(); b.classList.remove("dropping");
          const src = groups.find((x) => x.key === dragKey); dragKey = null;
          if (src && src !== g) openMerge([g, src], g.key);
        });
      }
      el.groupList.appendChild(b);
    }
    const n = state.groupChecked.size;
    el.btnMerge.classList.toggle("hidden", !(editing && n >= 2));
    el.btnMerge.textContent = `${n}개 합치기`;
    el.tracksCount.textContent = !groups.length ? "" : q ? `${shown.length} / ${groups.length}${k.unit}` : `${groups.length}${k.unit}`;
    el.searchEmpty.classList.toggle("hidden", !(q && groups.length && !shown.length));
  }

  function renderGroupDetail(g) {
    el.libQ.placeholder = "이 안에서 곡 찾기";
    el.groupHead.classList.remove("hidden");
    el.groupTitle.textContent = g.name;
    el.groupSub.textContent = [KINDS[g.kind].label, g.sub, `${g.tracks.length}곡`].filter(Boolean).join(" · ");
    const q = norm(el.libQ.value), cur = currentTrack();
    el.groupList.innerHTML = "";
    let shown = 0;
    g.tracks.forEach((t, i) => {
      if (q && !matchTrack(t, q)) return;
      shown++;
      el.groupList.appendChild(trackRow(t, i, {
        playing: !!cur && cur.id === t.id,
        sub: (g.kind === "album" ? t.tags.artist : tagSub(t)) || fmtSize(t.size),
        onPlay: () => playGroup(g, i),
        onAdd: () => openSheet(t),
        onMore: () => openTrackMenu(t),
      }));
    });
    el.tracksCount.textContent = q ? `${shown} / ${g.tracks.length}곡` : `${g.tracks.length}곡`;
    el.searchEmpty.classList.toggle("hidden", !(q && !shown));
  }

  // 지금 보이는 목록 = 재생할 곡들과 출처 이름 (곡 / 이름 목록 / 묶음 안, 검색으로 걸렀으면 그 결과만)
  function visibleList() {
    const v = state.libView, raw = el.libQ.value.trim(), q = norm(raw);
    const searched = q ? { type: "view", name: `검색: ${raw}` } : null;
    if (v.kind === "songs" || !KINDS[v.kind]) {
      const tracks = q ? state.library.filter((t) => matchTrack(t, q)) : state.library.slice();
      return { tracks, source: searched || { type: "library" } };
    }
    const k = KINDS[v.kind], groups = buildGroups(v.kind);
    const g = v.group != null ? groups.find((x) => x.key === v.group) : null;
    if (g) {
      const tracks = q ? g.tracks.filter((t) => matchTrack(t, q)) : g.tracks.slice();
      return { tracks, source: searched || { type: "group", kind: g.kind, key: g.key, name: g.name } };
    }
    // 이름 목록: 이름 순 → (각 묶음 안) 앨범 → 트랙 순으로 이어 붙임
    const shown = q ? groups.filter((x) => norm(x.name).includes(q) || norm(x.sub).includes(q)) : groups;
    return { tracks: shown.flatMap((x) => x.tracks), source: searched || { type: "view", name: `${k.label}: 전체` } };
  }
  // [▶ 재생] 처음부터 차례로, [⇄ 섞기] 섞어서 — 하단 섞기 아이콘도 같이 바뀜
  function playVisible(shuffle) {
    const { tracks, source } = visibleList();
    if (!tracks.length) { toast("재생할 곡이 없어요"); return; }
    setShuffle(shuffle);
    setQueue(source, tracks);
    state.pos = 0; playCurrent();
  }
  // 재생 버튼 줄은 목록 바로 위에 (곡 목록이면 곡 위, 분류면 이름 목록·묶음 곡 위)
  function placePlaybar(songs) {
    const anchor = songs ? el.trackList : el.groupList;
    if (el.libPlaybar.nextElementSibling !== anchor) anchor.before(el.libPlaybar);
    const none = !state.library.length;
    el.btnLibPlay.disabled = el.btnLibShuffle.disabled = none;
  }

  // 묶음을 재생 큐로 — i가 없으면 처음부터(섞기면 섞인 첫 곡)
  function playGroup(g, i) {
    setQueue({ type: "group", kind: g.kind, key: g.key, name: g.name }, g.tracks.slice());
    if (i == null) { state.pos = 0; playCurrent(); } else playIndex(i);
  }
  function currentGroup() {
    const v = state.libView;
    return v.group != null && KINDS[v.kind] ? buildGroups(v.kind).find((x) => x.key === v.group) : null;
  }

  // ── 보관함 고치기 (음악 파일은 그대로, drive-music-library.md만 바꿈) ──
  // 보관함 곡에 태그 붙이기 — 보관함에 없으면 읽기 전까지 파일명으로 (표지 유무는 아직 모름)
  function attachTags() {
    let filled = 0;
    for (const t of state.library) {
      const e = state.tagDb.get(t.id);
      if (e && !LANGS.includes(e.tags.language)) { e.tags.language = detectLang(e.tags.title, e.tags.artist); filled++; }
      t.tags = e ? e.tags : { ...fallbackTags(t), hasArt: null };
    }
    if (filled) saveLibrary();   // 언어를 새로 채웠으면 보관함 파일에도 적어둠
  }
  // 고칠 곡의 보관함 칸 (아직 태그를 못 읽은 곡이면 지금 값으로 만듦)
  function ensureEntry(t) {
    let e = state.tagDb.get(t.id);
    if (!e) { e = { tags: { ...(t.tags || fallbackTags(t)) }, folderName: t.folderName }; state.tagDb.set(t.id, e); }
    t.tags = e.tags;
    return e;
  }
  // savePlaylists처럼: 바로 기억 + 1.2초 뒤 드라이브에 올림
  function saveLibrary() {
    state.libDirty = true;
    clearTimeout(state.libSaveTimer);
    state.libSaveTimer = setTimeout(flushLibrary, 1200);
  }
  // 고친 뒤: 저장하고, 분류·곡 목록·플레이리스트·하단 플레이어를 다시 그림
  function afterLibEdit() {
    saveLibrary();
    renderLib();
    if (el.sTags.classList.contains("show")) renderTagEditor();
    if (state.openPl) renderPlaylistDetail();
    const cur = currentTrack();
    if (cur) { const e = state.tagDb.get(cur.id); if (e) cur.tags = e.tags; showNowPlayingText(cur); updateMediaSession(cur); }
  }

  // 되돌리기: 고치기 직전 보관함 내용을 이 기기에 한 벌 (마지막 한 번만)
  function rememberUndo(label) { store.set("libundo", { text: serializeLibrary(), label, at: Date.now() }); }
  function undoLast() {
    const u = store.get("libundo", null);
    if (!u) { toast("되돌릴 변경이 없어요"); return; }
    state.tagDb = parseLibrary(u.text);
    store.del("libundo");
    attachTags();
    afterLibEdit();
    toast(`되돌렸어요: ${u.label}`);
  }
  const undoAction = { label: "되돌리기", fn: undoLast };

  // 묶음(들)의 모든 곡의 그 칸(아티스트/앨범/작곡가/장르)을 name으로. 앨범이면 앨범아티스트도 맞춤
  function retagGroups(kind, groups, name, albumArtist, how) {
    const tracks = groups.flatMap((g) => g.tracks);
    if (!tracks.length) return;
    const shownName = name || KINDS[kind].unknown;
    rememberUndo(how === "rename" ? `${KINDS[kind].label} 이름 바꾸기 → '${shownName}'` : `${KINDS[kind].label} ${groups.length}개 → '${shownName}'`);
    for (const t of tracks) {
      const e = ensureEntry(t);
      e.tags[kind] = name;
      if (kind === "album" && albumArtist != null) e.tags.albumArtist = albumArtist;
      e.edited = true;
    }
    // 그 묶음을 듣던 중이면 출처 이름도 바꿈
    const src = state.source;
    if (src.type === "group" && src.kind === kind && groups.some((g) => g.key === src.key)) {
      src.name = shownName;
      src.key = !name ? "" : kind === "album" ? name + "\u0001" + (albumArtist || "") : name;
    }
    state.groupEditing = false; state.groupChecked.clear();
    closeMSheet();
    afterLibEdit();
    toast(how === "rename" ? `${tracks.length}곡의 이름을 '${shownName}'로 바꿨어요` : `${tracks.length}곡을 '${shownName}'로 옮겼어요`, undoAction);
  }
  const albumArtistOf = (g) => (g.key.split("\u0001")[1] || "");

  // 기존 값 고르기용 목록(<datalist>) 채우기
  function fillDatalists() {
    const sets = { artist: new Set(), album: new Set(), genre: new Set(), composer: new Set() };
    for (const e of state.tagDb.values()) {
      for (const k in sets) if (e.tags[k]) sets[k].add(e.tags[k]);
      if (e.tags.albumArtist) sets.artist.add(e.tags.albumArtist);
    }
    for (const k in sets) {
      const dl = document.getElementById("dl-" + k);
      dl.innerHTML = "";
      for (const v of [...sets[k]].sort(libColl.compare).slice(0, 800)) { const o = document.createElement("option"); o.value = v; dl.appendChild(o); }
    }
  }

  // 만능 바텀시트: 제목·설명·내용, ok가 있으면 아래에 취소/확인. ok.fn이 false를 돌려주면 안 닫음
  let msheetOk = null;
  function openMSheet({ title, sub = "", body, ok = null }) {
    el.msheetTitle.textContent = title;
    el.msheetSub.textContent = sub;
    el.msheetSub.classList.toggle("hidden", !sub);
    el.msheetBody.innerHTML = "";
    el.msheetBody.appendChild(body);
    el.msheetBtns.classList.toggle("hidden", !ok);
    msheetOk = ok;
    if (ok) el.msheetOk.textContent = ok.label;
    el.dim.classList.add("show"); el.msheet.classList.add("show");
  }
  function closeMSheet() { el.msheet.classList.remove("show"); if (!el.sheet.classList.contains("show")) el.dim.classList.remove("show"); msheetOk = null; }
  el.msheetOk.onclick = () => { if (msheetOk && msheetOk.fn() !== false) closeMSheet(); };
  const elt = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
  // 바텀시트 안 메뉴 한 줄
  function menuRow(name, sub, fn, off = false) {
    const b = elt(`<button class="row${off ? " off" : ""}"><div class="t"><div class="n"></div><div class="s"></div></div></button>`);
    b.querySelector(".n").textContent = name; b.querySelector(".s").textContent = sub || "";
    b.onclick = fn;
    return b;
  }

  // 합치기 창: 남길 이름을 체크한 것 중에서 고르거나 새로 적기
  function openMerge(groups, defaultKey) {
    const kind = groups[0].kind, k = KINDS[kind];
    const total = groups.reduce((n, g) => n + g.tracks.length, 0);
    let choice = defaultKey != null ? defaultKey : groups[0].key;
    fillDatalists();
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px";
    const rows = [];
    const paint = () => rows.forEach(([key, r]) => r.classList.toggle("on", key === choice));
    for (const g of groups) {
      const r = elt(`<button class="row"><div class="chk"></div><div class="t"><div class="n"></div><div class="s"></div></div></button>`);
      r.querySelector(".n").textContent = g.name;
      r.querySelector(".s").textContent = [g.sub, `${g.tracks.length}곡`].filter(Boolean).join(" · ");
      r.onclick = () => { choice = g.key; paint(); };
      rows.push([g.key, r]); body.appendChild(r);
    }
    const nr = elt(`<div class="row"><div class="chk"></div><input placeholder="새 이름 적기" autocomplete="off" list="dl-${kind === "composer" ? "composer" : kind}" /></div>`);
    const input = nr.querySelector("input");
    nr.querySelector(".chk").onclick = () => { choice = "__new"; paint(); input.focus(); };
    input.addEventListener("focus", () => { choice = "__new"; paint(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.msheetOk.click(); });
    if (kind !== "language") { rows.push(["__new", nr]); body.appendChild(nr); }   // 언어는 정해진 다섯 값만
    paint();
    openMSheet({
      title: `${k.label} ${groups.length}개 합치기`, sub: `${total}곡을 한 ${k.label}(으)로 — 남길 이름을 고르세요`, body,
      ok: { label: "합치기", fn: () => {
        if (choice === "__new") {
          const name = input.value.trim();
          if (!name) { toast("새 이름을 적어주세요"); return false; }
          retagGroups(kind, groups, name, kind === "album" ? albumArtistOf(groups[0]) : null);
        } else {
          const g = groups.find((x) => x.key === choice);
          retagGroups(kind, groups, g.unknown ? "" : g.name, kind === "album" ? albumArtistOf(g) : null);
        }
        return false;   // retagGroups가 닫음
      } },
    });
  }

  // 이름 바꾸기 (그 묶음 전체 곡)
  function openRename(g) {
    const kind = g.kind, k = KINDS[kind];
    fillDatalists();
    const body = kind === "language"
      ? elt(`<label class="field">바꿀 언어<select>${LANGS.map((l) => `<option>${l}</option>`).join("")}</select></label>`)
      : elt(`<label class="field">새 ${k.label} 이름<input autocomplete="off" list="dl-${kind}" /></label>`);
    const input = body.querySelector("input, select");
    input.value = g.unknown ? "" : g.name;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.msheetOk.click(); });
    openMSheet({
      title: `${k.label} 이름 바꾸기`, sub: `${g.name} · ${g.tracks.length}곡 전부에 적용`, body,
      ok: { label: "바꾸기", fn: () => {
        const name = input.value.trim();
        if (name === (g.unknown ? "" : g.name)) return true;
        retagGroups(kind, [g], name, kind === "album" ? albumArtistOf(g) : null, "rename");
        return false;
      } },
    });
    if (input.select) setTimeout(() => input.select(), 250);
  }

  // 곡 줄 ⋯ 메뉴
  function openTrackMenu(t) {
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px";
    body.appendChild(menuRow("태그 편집", "제목·아티스트·앨범 등 (음악 파일은 그대로)", () => openTagForm(t)));
    body.appendChild(menuRow("플레이리스트에 담기", "", () => { closeMSheet(); openSheet(t); }));
    openMSheet({ title: dispTitle(t), sub: tagSub(t) || t.name, body });
  }

  // 곡 하나 태그 고치기
  const TAG_FIELDS = [
    ["title", "제목"], ["artist", "아티스트", "artist"], ["album", "앨범", "album"], ["albumArtist", "앨범 아티스트", "artist"],
    ["composer", "작곡가", "composer"], ["genre", "장르", "genre"], ["language", "언어", null, "select"],
    ["track", "트랙", null, "numeric"], ["year", "연도", null, "numeric"],
  ];
  function openTagForm(t) {
    fillDatalists();
    const g = t.tags || fallbackTags(t);
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px";
    const inputs = {};
    let pair = null;
    for (const [key, label, dl, mode] of TAG_FIELDS) {
      const f = mode === "select"
        ? elt(`<label class="field">${label}<select>${LANGS.map((l) => `<option>${l}</option>`).join("")}</select></label>`)
        : elt(`<label class="field">${label}<input autocomplete="off" /></label>`);
      const input = f.querySelector("input, select");
      if (dl) input.setAttribute("list", "dl-" + dl);
      if (mode && mode !== "select") input.inputMode = mode;
      input.value = g[key] || (key === "language" ? detectLang(g.title, g.artist) : "");
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.msheetOk.click(); });
      inputs[key] = input;
      if (key === "track" || key === "year") {   // 트랙·연도는 한 줄에 둘
        if (!pair) { pair = elt(`<div class="two"></div>`); body.appendChild(pair); }
        pair.appendChild(f);
      } else body.appendChild(f);
    }
    let langTouched = false;
    inputs.language.addEventListener("change", () => { langTouched = true; });
    for (const k of ["title", "artist"]) inputs[k].addEventListener("input", () => {
      if (!langTouched) inputs.language.value = detectLang(inputs.title.value, inputs.artist.value);
    });
    openMSheet({
      title: "태그 편집", sub: `${t.name} · 음악 파일은 안 바뀌고 보관함에만 저장돼요`, body,
      ok: { label: "저장", fn: () => {
        const vals = {};
        for (const [key] of TAG_FIELDS) vals[key] = inputs[key].value.trim();
        if (!vals.title) vals.title = stripExt(t.name);
        const e0 = state.tagDb.get(t.id);
        if (e0 && TAG_FIELDS.every(([key]) => (e0.tags[key] || "") === vals[key])) return true;   // 바뀐 게 없음
        rememberUndo(`'${dispTitle(t)}' 태그 편집`);
        const e = ensureEntry(t);
        Object.assign(e.tags, vals);
        e.edited = true;
        afterLibEdit();
        toast("태그를 고쳤어요", undoAction);
        return true;
      } },
    });
  }

  // 보관함 머리 ⋯ 메뉴: 마지막 변경 되돌리기, 태그 전부 다시 읽기
  function openLibMenu() {
    const u = store.get("libundo", null);
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px";
    body.appendChild(menuRow("태그 목록 편집", "아티스트·앨범·작곡가·장르·언어 값 이름 바꾸기·합치기", () => { closeMSheet(); openTagEditor(); }));
    body.appendChild(menuRow("마지막 변경 되돌리기", u ? u.label : "되돌릴 변경이 없어요", () => { closeMSheet(); undoLast(); }, !u));
    body.appendChild(menuRow("태그 전부 다시 읽기", "새로고침 아이콘 길게 누르기와 같아요", () => { closeMSheet(); retagAll(); }));
    openMSheet({ title: "보관함", body });
  }

  // 태그 전부 다시 읽기 — 앱에서 고친 곡이 있으면 버릴지 물어봄
  function retagAll() {
    if (!state.folder) return;
    const nEdited = state.library.filter((t) => { const e = state.tagDb.get(t.id); return e && e.edited; }).length;
    let dropEdits = false;
    if (nEdited) dropEdits = confirm(`앱에서 고친 곡이 ${nEdited}곡 있어요. 고친 태그도 버릴까요?\n\n확인 = 고친 것도 버리고 파일의 원래 태그로\n취소 = 고친 곡은 그대로 두고 나머지만 다시 읽기`);
    rememberUndo(dropEdits ? "태그 전부 다시 읽기 (고친 태그 버림)" : "태그 전부 다시 읽기");   // 다시 읽기 전 상태로 되돌릴 수 있게
    toast(dropEdits || !nEdited ? "태그를 처음부터 전부 다시 읽어요" : "고친 곡은 두고 나머지를 다시 읽어요");
    openFolder(state.folder, { retag: true, dropEdits });
  }

  // ── 태그 목록 편집 화면 ────────────────────────────────────
  //  태그 종류를 고르면 값 목록(곡 수). ✎ 이름 바꾸기, ≡ 를 잡고 다른 값 위에 놓으면 합치기(몇 곡 바뀌는지 보고 확인)
  //  끌기는 마우스·손가락 둘 다 되게 pointer 이벤트로 직접 (HTML5 drag는 폰에서 안 됨)
  const SVG_GRIP = `<svg viewBox="0 0 24 24"><path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"/></svg>`;
  function openTagEditor() {
    state.tagEdKind = store.get("tagedkind", "artist");
    if (!KINDS[state.tagEdKind]) state.tagEdKind = "artist";
    el.tagsQ.value = "";
    show(el.sTags);
    el.hdrSub.textContent = state.folder ? state.folder.name : "";
    renderTagEditor();
  }
  function closeTagEditor() {
    show(el.sTracks);
    el.hdrSub.textContent = state.folder ? state.folder.name : "";
    showTab("lib");
    renderLib();
  }
  function renderTagEditor() {
    const kind = state.tagEdKind, k = KINDS[kind];
    for (const b of el.tagKinds.querySelectorAll("button")) b.classList.toggle("on", b.dataset.kind === kind);
    const groups = buildGroups(kind);
    const q = norm(el.tagsQ.value);
    const shown = q ? groups.filter((g) => norm(g.name).includes(q) || norm(g.sub).includes(q)) : groups;
    el.tagsCount.textContent = groups.length ? `${q ? shown.length + " / " : ""}${groups.length}${k.unit}` : "";
    el.tagList.innerHTML = "";
    if (!state.library.length) { el.tagList.innerHTML = `<div class="empty">곡이 없어요. 먼저 폴더를 열어주세요.</div>`; return; }
    for (const g of shown) {
      const b = document.createElement("div");
      b.className = "row";
      b.dataset.key = g.key;
      b.innerHTML = `<div class="ic grp${g.unknown ? " unknown" : ""}">${SVG_KIND[kind]}</div>
        <div class="t"><div class="n"></div><div class="s"></div></div>`;
      b.querySelector(".n").textContent = g.name;
      b.querySelector(".s").textContent = [g.sub, `${g.tracks.length}곡`].filter(Boolean).join(" · ");
      const pen = document.createElement("button");
      pen.className = "act"; pen.title = "이름 바꾸기"; pen.innerHTML = SVG_PEN; pen.onclick = () => openRename(g);
      const grip = document.createElement("div");
      grip.className = "grip"; grip.title = "끌어서 다른 값 위에 놓으면 합치기"; grip.innerHTML = SVG_GRIP;
      grip.addEventListener("pointerdown", (e) => startTagDrag(e, b, g, groups));
      b.append(pen, grip);
      el.tagList.appendChild(b);
    }
  }

  // ≡ 를 잡고 끌기: 떠다니는 복사본이 손가락을 따라오고, 아래 있는 줄에 점선 표시. 놓으면 합치기 확인
  function startTagDrag(e, row, g, groups) {
    e.preventDefault();
    const grip = e.currentTarget;
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add("dragghost");
    Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: 0 });
    document.body.appendChild(ghost);
    row.classList.add("lifted");
    const dy = e.clientY - r.top;
    let over = null, lastY = e.clientY;
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const scroller = setInterval(() => {   // 화면 위·아래 끝에 가까우면 목록을 굴림
      const top = mainEl.getBoundingClientRect().top, bottom = Math.min(window.innerHeight, mainEl.getBoundingClientRect().bottom);
      if (lastY < top + 60) mainEl.scrollTop -= 14; else if (lastY > bottom - 170) mainEl.scrollTop += 14;
    }, 30);
    const move = (ev) => {
      lastY = ev.clientY;
      ghost.style.top = (ev.clientY - dy) + "px";
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = hit && hit.closest("#tag-list .row");
      const next = target && target !== row ? target : null;
      if (over !== next) { if (over) over.classList.remove("dropping"); over = next; if (over) over.classList.add("dropping"); }
    };
    const end = (drop) => {
      clearInterval(scroller);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onCancel);
      ghost.remove(); row.classList.remove("lifted");
      if (over) over.classList.remove("dropping");
      if (drop && over) { const dst = groups.find((x) => x.key === over.dataset.key); if (dst && dst !== g) openDropMerge(g, dst); }
    };
    const onUp = () => end(true), onCancel = () => end(false);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onCancel);
  }

  // 끌어 포갠 두 값 합치기 확인: 어느 이름을 남길지 고르면 몇 곡이 바뀌는지 보여줌
  function openDropMerge(src, dst) {
    const kind = src.kind, k = KINDS[kind];
    let keep = dst;   // 기본은 놓은 곳(아래 줄)의 이름
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px";
    const opts = [dst, src].map((g) => {
      const other = g === dst ? src : dst;
      const r = elt(`<button class="row"><div class="chk"></div><div class="t"><div class="n"></div><div class="s"></div></div></button>`);
      r.querySelector(".n").textContent = `'${g.name}'로 합치기`;
      r.querySelector(".s").textContent = `'${other.name}'의 ${other.tracks.length}곡이 바뀜`;
      r.onclick = () => { keep = g; paint(); };
      body.appendChild(r);
      return [g, r];
    });
    const paint = () => {
      for (const [g, r] of opts) r.classList.toggle("on", g === keep);
      el.msheetOk.textContent = `합치기 (${(keep === dst ? src : dst).tracks.length}곡 바뀜)`;
    };
    openMSheet({
      title: `${k.label} 합치기`, sub: `'${src.name}' ${src.tracks.length}곡 + '${dst.name}' ${dst.tracks.length}곡`, body,
      ok: { label: "합치기", fn: () => {
        const from = keep === dst ? src : dst;
        retagGroups(kind, [from], keep.unknown ? "" : keep.name, kind === "album" ? albumArtistOf(keep) : null);
        return false;
      } },
    });
    paint();
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
      state.plFileId = await uploadMd(state.plFileId, PL_FILE, serializePlaylists());
      el.plSync.textContent = state.playlists.length ? `${state.playlists.length}개` : "";
    } catch (e) {
      state.plDirty = true;
      el.plSync.textContent = "저장 실패 — 다시 시도함";
      setTimeout(flushPlaylists, 5000);
    }
  }
  window.addEventListener("pagehide", () => { if (state.plDirty) flushPlaylists(); });

  // 드라이브에 .md 파일 올리기: 처음엔 새로 만들고(multipart), 그다음부턴 내용만 바꿈(PATCH)
  async function uploadMd(fileId, name, body) {
    if (fileId) {
      await driveFetch(`/files/${fileId}`, { uploadType: "media" },
        { method: "PATCH", upload: true, headers: { "Content-Type": "text/markdown" }, body });
      return fileId;
    }
    const meta = { name, mimeType: "text/markdown" };
    const boundary = "dm" + Date.now();
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await driveFetch("/files", { uploadType: "multipart", fields: "id" },
      { method: "POST", upload: true, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
    return (await res.json()).id;
  }

  // ── 보관함: 곡 태그를 드라이브의 .md 파일로 저장 ─────────────
  //  파일 모양 (한 곡 한 줄, 앨범 표지는 안 넣음):
  //  - 파일ID | 제목 | 아티스트 | 앨범 | 앨범아티스트 | 작곡가 | 장르 | 트랙 | 연도 | 폴더 | 언어
  //  사용자가 앱에서 고친 곡은 줄 끝에 " | edited" — 태그를 다시 읽어도 그 값을 지킴
  //  (언어 칸이 없는 예전 줄도 읽힘 → 열 때 제목·아티스트로 채움)
  const LIB_COLS = ["title", "artist", "album", "albumArtist", "composer", "genre", "track", "year"];
  const cell = (v) => String(v == null ? "" : v).replace(/\|/g, "∣").replace(/\s*\r?\n\s*/g, " ").trim();
  function serializeLibrary() {
    const lines = ["# Drive Music 보관함", "",
      "<!-- 이 파일은 Drive Music 앱이 음악 파일 안의 태그를 읽어 적어둔 것입니다. 앨범 표지는 들어있지 않아요. 줄 모양: - 파일ID | 제목 | 아티스트 | 앨범 | 앨범아티스트 | 작곡가 | 장르 | 트랙 | 연도 | 폴더 | 언어 (앱에서 고친 곡은 끝에 | edited) -->", ""];
    const coll = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
    const rows = [...state.tagDb.entries()].sort(([, a], [, b]) => coll.compare(a.folderName || "", b.folderName || "") ||
      (Number(a.tags.track) || 0) - (Number(b.tags.track) || 0) || coll.compare(a.tags.title || "", b.tags.title || ""));
    for (const [id, e] of rows) lines.push(`- ${[id, ...LIB_COLS.map((k) => e.tags[k]), e.folderName, e.tags.language || "", ...(e.edited ? ["edited"] : [])].map(cell).join(" | ")}`);
    lines.push("");
    return lines.join("\n");
  }
  function parseLibrary(text) {
    const out = new Map();
    for (const raw of (text || "").split(/\r?\n/)) {
      const m = raw.trim().match(/^-\s+([A-Za-z0-9_-]{10,})\s*\|(.*)$/);
      if (!m) continue;
      const p = m[2].split("|").map((x) => x.trim());
      if (p.length < 9) continue;
      const edited = p.length >= 10 && p[p.length - 1] === "edited";
      if (edited) p.pop();
      const tags = { hasArt: null };   // 표지는 파일에 없음 → 재생할 때 알게 됨
      if (p.length >= 10 && (LANGS.includes(p[p.length - 1]) || p[p.length - 1] === "")) tags.language = p.pop();
      LIB_COLS.forEach((k, i) => { tags[k] = p[i] || ""; });
      out.set(m[1], edited ? { tags, folderName: p.slice(8).join("|"), edited: true } : { tags, folderName: p.slice(8).join("|") });
    }
    return out;
  }

  let tagDbLoading = null;   // 한 번만 읽음 (여러 번 불러도 같은 약속을 기다림)
  function loadTagDb() {
    if (tagDbLoading) return tagDbLoading;
    tagDbLoading = (async () => {
      // 이 기기에 남은 복사본 먼저, 드라이브 것이 있으면 덮어씀
      for (const [id, e] of Object.entries(store.get("library", {}))) if (e && e.tags) state.tagDb.set(id, e);
      try {
        const res = await driveFetch("/files", {
          q: `name = '${LIB_FILE}' and trashed = false`, fields: "files(id)", spaces: "drive", pageSize: "1",
        });
        const j = await res.json();
        if (j.files && j.files.length) {
          state.libFileId = j.files[0].id;
          const r2 = await driveFetch(`/files/${state.libFileId}`, { alt: "media" });
          for (const [id, e] of parseLibrary(await r2.text())) state.tagDb.set(id, e);
        }
      } catch (e) {
        console.warn("보관함 파일을 못 읽었어요", e);
        tagDbLoading = null;   // 다음에 폴더를 열 때 다시 시도
      }
    })();
    return tagDbLoading;
  }

  async function flushLibrary() {
    if (state.libSaving) { state.libAgain = true; return; }   // 올리는 중이면 끝난 뒤 한 번 더
    if (!state.libDirty) return;
    state.libSaving = true; state.libDirty = false;
    try {
      const obj = {};
      for (const [id, e] of state.tagDb) obj[id] = { tags: { ...e.tags, hasArt: null }, folderName: e.folderName, edited: !!e.edited };
      store.set("library", obj);
      state.libFileId = await uploadMd(state.libFileId, LIB_FILE, serializeLibrary());
    } catch (e) {
      state.libDirty = true;
      console.warn("보관함 저장 실패 — 다시 시도함", e);
      setTimeout(flushLibrary, 5000);
    } finally {
      state.libSaving = false;
      if (state.libAgain) { state.libAgain = false; flushLibrary(); }
    }
  }
  window.addEventListener("pagehide", () => { if (state.libDirty) flushLibrary(); });

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
    p.items.push({ id: t.id, title: dispTitle(t), folderName: t.folderName || "" });
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
    ({ id: it.id, name: it.title, title: it.title, size: 0, mimeType: "audio/", folderName: it.folderName,
       tags: (state.tagDb.get(it.id) || {}).tags }));

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
        sub: tagSub(t) || t.folderName || (inLib ? "" : "다른 폴더의 곡"),
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
    setShuffle(shuffle);
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
    el.sheetTrack.textContent = dispTitle(t);
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

  // ── 음악 태그 읽기 (파일 앞부분만 받아서) ───────────────────
  //  mp3: 맨 앞 ID3v2 머리에 적힌 길이만큼만 / 없으면 맨 끝 128바이트(ID3v1)
  //  flac: 맨 앞 정보 칸(메타데이터 블록)들이 끝나는 곳까지
  //  m4a: 맨 위 상자(ftyp, moov)만 — moov가 파일 끝에 있어도 그 자리만 받음
  const CHUNK = 1024 * 1024, HEAD_SMALL = 128 * 1024, TAG_MAX = 16 * 1024 * 1024;

  function fallbackTags(t) {
    return { title: stripExt(t.name), artist: "", album: t.folderName || "", albumArtist: "", composer: "",
      genre: "", track: "", year: "", language: detectLang(stripExt(t.name)), hasArt: false };
  }

  // 파일의 [start, end] 바이트만 받기. start < 0 이면 끝에서부터
  async function fetchBytes(id, start, end) {
    const range = start < 0 ? `bytes=${start}` : `bytes=${start}-${end}`;
    const res = await driveFetch(`/files/${id}`, { alt: "media", supportsAllDrives: "true" }, { headers: { Range: range } });
    if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
    // 서버가 일부만 주지 않고 통째로 보내는 경우 — 필요한 만큼만 읽고 끊음
    if (start < 0 || !res.body) { const all = new Uint8Array(await res.arrayBuffer()); return start < 0 ? all.slice(start) : all.slice(start, end + 1); }
    const reader = res.body.getReader(); const parts = []; let got = 0;
    while (got <= end) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; }
    reader.cancel().catch(() => {});
    return joinBytes(parts).slice(start, end + 1);
  }
  function joinBytes(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // 드라이브 파일을 조각조각 받아 들고 있는 상자. getAt(위치, 길이)로 꺼냄
  //  exact=true: 딱 그만큼만 받음 (길이를 이미 아는 태그 통째로) / false: 넉넉히 받아 요청 수를 줄임 (머리 훑기)
  function remoteFile(t, firstChunk) {
    const size = Number(t.size) || 0;
    const pieces = [];   // [{ start, bytes }]
    async function getAt(off, len, exact = false) {
      if (size && off + len > size) len = size - off;
      if (len <= 0) return new Uint8Array(0);
      let c = pieces.find((x) => off >= x.start && off <= x.start + x.bytes.length);
      if (c && off + len <= c.start + c.bytes.length) return c.bytes.subarray(off - c.start, off - c.start + len);
      const from = c ? c.start + c.bytes.length : off;                 // 이어 붙일 수 있으면 모자란 뒤쪽만
      let to = exact ? off + len - 1 : Math.max(off + len, from + (pieces.length ? CHUNK : firstChunk)) - 1;
      if (size) to = Math.min(to, size - 1);
      const more = await fetchBytes(t.id, from, to);
      if (c) c.bytes = joinBytes([c.bytes, more]); else pieces.push(c = { start: off, bytes: more });
      return c.bytes.subarray(off - c.start, Math.min(off - c.start + len, c.bytes.length));
    }
    return { size, getAt };
  }

  const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

  // 음악 파일에서 태그가 든 부분만 모아 작은 Blob으로 만듦 (없으면 null)
  async function tagBlobOf(t) {
    const ext = (t.name.split(".").pop() || "").toLowerCase();
    const f = remoteFile(t, ["m4a", "mp4", "aac", "alac", "flac"].includes(ext) ? CHUNK : HEAD_SMALL);
    const head = await f.getAt(0, 12);
    if (head.length < 12) return null;
    if (ascii(head, 0, 3) === "ID3") {
      const len = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f)) + (head[5] & 0x10 ? 10 : 0);
      if (len > TAG_MAX) return null;
      return { kind: "id3", blob: new Blob([await f.getAt(0, len, true)]) };
    }
    if (ascii(head, 0, 4) === "fLaC") {
      let off = 4;
      for (let i = 0; i < 128 && off < TAG_MAX; i++) {
        const h = await f.getAt(off, 4);
        if (h.length < 4) break;
        off += 4 + ((h[1] << 16) | (h[2] << 8) | h[3]);
        if (h[0] & 0x80) break;   // 마지막 정보 칸
      }
      const bytes = (await f.getAt(0, off, true)).slice();
      return { kind: "flac", blob: new Blob([bytes]), bytes };
    }
    if (ascii(head, 4, 4) === "ftyp") {
      const parts = []; let off = 0;
      for (let i = 0; i < 64; i++) {
        if (f.size && off + 8 > f.size) break;
        const h = await f.getAt(off, 16);
        if (h.length < 8) break;
        let sz = u32(h, 0); const name = ascii(h, 4, 4);
        if (sz === 1) sz = u32(h, 8) * 2 ** 32 + u32(h, 12);
        if (sz === 0) sz = f.size - off;
        if (sz < 8) break;
        if (name === "ftyp" || name === "moov") {
          if (sz > TAG_MAX) break;
          parts.push((await f.getAt(off, sz, true)).slice());
          if (name === "moov") return { kind: "mp4", blob: new Blob(parts) };
        }
        off += sz;
      }
      return null;
    }
    // 머리에 태그가 없으면 맨 끝 128바이트(옛날 mp3 태그)
    if (!f.size || f.size > 128) {
      const tail = await fetchBytes(t.id, -128);
      if (tail.length === 128 && ascii(tail, 0, 3) === "TAG") return { kind: "id3v1", blob: new Blob([tail]) };
    }
    return null;
  }

  const readTagBlob = (blob) => new Promise((resolve, reject) => window.jsmediatags.read(blob, { onSuccess: resolve, onError: reject }));

  // 옛날 한국 mp3는 태그를 EUC-KR로 적어둔 경우가 많아 글자가 깨짐 → 다시 풀어봄
  const fixKo = (s) => {
    if (!s || !/[\u0080-\u00ff]/.test(s) || /[^\u0000-\u00ff]/.test(s)) return s;
    try { return new TextDecoder("euc-kr", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0))); } catch { return s; }
  };
  const tagText = (v) => {
    if (v == null) return "";
    if (typeof v === "object" && !Array.isArray(v)) return tagText(v.data);
    if (typeof v !== "string" && typeof v !== "number") return "";
    return fixKo(String(v)).replace(/\u0000+$/, "").replace(/\u0000/g, " / ").trim();
  };

  // FLAC 글자 태그(Vorbis comment)를 직접 읽음 — jsmediatags가 작곡가·앨범아티스트·연도는 안 줘서
  function flacComments(b) {
    const out = {}; let off = 4;
    while (off + 4 <= b.length) {
      const last = b[off] & 0x80, type = b[off] & 0x7f, len = (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3], s = off + 4;
      if (type === 4 && s + len <= b.length) {
        const dv = new DataView(b.buffer, b.byteOffset + s, len), dec = new TextDecoder();
        let p = 4 + dv.getUint32(0, true);
        const n = dv.getUint32(p, true); p += 4;
        for (let i = 0; i < n && p + 4 <= len; i++) {
          const cl = dv.getUint32(p, true); p += 4;
          const c = dec.decode(b.subarray(s + p, s + p + cl)); p += cl;
          const k = c.indexOf("=");
          if (k > 0) { const key = c.slice(0, k).toUpperCase(); if (!(key in out)) out[key] = c.slice(k + 1); }
        }
      }
      off = s + len;
      if (last) break;
    }
    return out;
  }

  // jsmediatags 결과 → 우리 모양 { title, artist, album, albumArtist, composer, genre, track, year, hasArt }
  function pickTags(t, result, flacBytes) {
    const out = pickTags0(t, result, flacBytes);
    out.language = detectLang(out.title, out.artist);
    return out;
  }
  function pickTags0(t, result, flacBytes) {
    const T = (result && result.tags) || {};
    const fb = fallbackTags(t);
    const vc = flacBytes ? flacComments(flacBytes) : {};
    const first = (...vs) => { for (const v of vs) { const x = tagText(v); if (x) return x; } return ""; };
    const year = first(T.year, T.TDRC, T.TYER, T["©day"], vc.DATE, vc.YEAR).match(/\d{4}/);
    const track = String(first(T.track, vc.TRACKNUMBER)).match(/\d+/);
    return {
      title: first(T.title, vc.TITLE) || fb.title,
      artist: first(T.artist, vc.ARTIST),
      album: first(T.album, vc.ALBUM) || fb.album,
      albumArtist: first(T.TPE2, T.TP2, T.aART, vc.ALBUMARTIST, vc["ALBUM ARTIST"]),
      composer: first(T.TCOM, T.TCM, T["©wrt"], vc.COMPOSER),
      genre: first(T.genre, vc.GENRE).replace(/^\((\d+)\)(?=.)/, ""),
      track: track ? String(Number(track[0])) : "",
      year: year ? year[0] : "",
      hasArt: !!(T.picture && T.picture.data && T.picture.data.length),
    };
  }

  // 한 곡의 태그 읽기. 태그가 없거나 못 알아보면 파일명·폴더명으로 채움 (인터넷 오류는 throw → 다음에 다시)
  async function readTagsRemote(t) {
    const part = await tagBlobOf(t);
    if (!part) return fallbackTags(t);
    let result = null;
    try { result = await readTagBlob(part.blob); } catch { /* 태그 모양이 이상함 → 아래에서 파일명으로 */ }
    return pickTags(t, result, part.bytes);
  }

  function setTagProgress(text) {
    el.tagProgress.classList.toggle("hidden", !text);
    el.tagProgress.innerHTML = text ? `<span class="spinner" style="width:12px;height:12px;border-width:2px"></span> ` : "";
    if (text) el.tagProgress.append(text);
  }

  // 폴더의 곡들 태그 읽기 — 보관함에 없는 곡만 (all=true면 전부). 동시에 TAG_WORKERS곡씩
  //  dropEdits=true일 때만 앱에서 고친(edited) 곡도 파일 태그로 되돌림
  async function scanTags(all = false, dropEdits = false) {
    const my = ++state.scanId;
    if (!window.jsmediatags) { console.warn("jsmediatags를 못 불러와서 태그를 안 읽어요"); return; }
    const todo = state.library.filter((t) => { const e = state.tagDb.get(t.id); return !e || (all && (dropEdits || !e.edited)); });
    if (!todo.length) { setTagProgress(""); return; }
    const total = todo.length; let done = 0, next = 0, sinceSave = 0;
    setTagProgress(`태그 읽는 중 0/${total}`);
    const worker = async () => {
      while (next < todo.length && my === state.scanId) {
        const t = todo[next++];
        try {
          const tags = await readTagsRemote(t);
          if (my !== state.scanId) return;
          const old = state.tagDb.get(t.id);
          if (old && old.edited && !dropEdits) { done++; continue; }   // 읽는 사이에 사용자가 고쳤음 → 그대로
          t.tags = tags;
          state.tagDb.set(t.id, { tags, folderName: t.folderName });
          state.libDirty = true;
          if (++sinceSave >= 25) { sinceSave = 0; flushLibrary(); }   // 중간중간 저장
          updateTrackRows(t);
        } catch (e) {
          console.warn("태그 읽기 실패:", t.name, e.message);   // 보관함에 안 넣음 → 다음에 다시 시도
        }
        done++;
        if (my === state.scanId) setTagProgress(`태그 읽는 중 ${done}/${total}`);
      }
    };
    await Promise.all(Array.from({ length: TAG_WORKERS }, worker));
    if (my !== state.scanId) return;
    setTagProgress("");
    flushLibrary();
    if (state.libView.kind !== "songs") renderLib();   // 묶음은 태그가 다 모여야 정확함
  }

  // 태그를 읽은 곡의 줄만 고쳐 그림 (목록 전체를 다시 그리지 않음)
  function updateTrackRows(t) {
    for (const r of document.querySelectorAll(["#track-list", "#pl-tracks", "#group-list"].map((l) => `${l} .row[data-id="${CSS.escape(t.id)}"]`).join(", "))) {
      r.querySelector(".n").textContent = dispTitle(t);
      if (r.closest("#track-list")) r.querySelector(".s").textContent = tagSub(t) || fmtSize(t.size);
    }
    const cur = currentTrack();
    if (cur && cur.id === t.id) {
      if (cur !== t) cur.tags = t.tags;
      showNowPlayingText(cur); updateMediaSession(cur);
      // 태그 읽기 전에 재생을 시작했으면 표지를 지금 붙임
      const url = state.blobUrls.get(cur.id);
      if (url && cur.tags.hasArt && !state.arts.has(cur.id))
        loadArt(cur, url).then((art) => { if (art && currentTrack() === cur) { showArt(art); updateMediaSession(cur, art); } });
    }
  }

  // 표지: 재생할 때 받아둔 파일에서 다시 읽음 (메모리에만, 최근 12곡)
  async function loadArt(t, url) {
    if (!window.jsmediatags || (t.tags && t.tags.hasArt === false)) return null;
    if (state.arts.has(t.id)) return state.arts.get(t.id);
    try {
      const blob = await (await fetch(url)).blob();
      const r = await readTagBlob(blob);
      const pic = r && r.tags && r.tags.picture;
      if (t.tags) t.tags.hasArt = !!(pic && pic.data && pic.data.length);
      if (!t.tags || !t.tags.hasArt) return null;
      let type = String(pic.format || "image/jpeg").toLowerCase();
      if (!type.includes("/")) type = "image/" + (type === "jpg" ? "jpeg" : type);
      const art = URL.createObjectURL(new Blob([new Uint8Array(pic.data)], { type }));
      state.arts.set(t.id, art);
      if (state.arts.size > 12) {
        const oldest = state.arts.keys().next().value;
        if (oldest !== t.id) { URL.revokeObjectURL(state.arts.get(oldest)); state.arts.delete(oldest); }
      }
      return art;
    } catch {
      return null;
    }
  }

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
      saveQueue();
      updateMediaSession(t);
      prefetchNext();
      loadArt(t, url).then((art) => { if (art && currentTrack() === t) { showArt(art); updateMediaSession(t, art); } });
    } catch (e) {
      el.npSub.textContent = "재생 실패: " + e.message;
    } finally {
      if (state.loadingId === t.id) el.npLoading.classList.add("hidden");
    }
  }

  function showNowPlaying(t) {
    showNowPlayingText(t);
    showArt(state.arts.get(t.id) || null);
  }
  function showNowPlayingText(t) {
    const artist = (t.tags && t.tags.artist) || "";
    el.npTitle.textContent = dispTitle(t);
    const src = state.source;
    const from = src.type === "playlist" ? src.name
      : src.type === "group" ? `${(KINDS[src.kind] || {}).label || ""}: ${src.name}`
      : src.type === "view" ? src.name : "전체 곡";
    el.npSub.textContent = [src.type === "group" && src.kind === "artist" ? "" : artist, `♪ ${from}`].filter(Boolean).join(" · ");
    document.title = dispTitle(t) + " · Drive Music";
  }
  // 하단 플레이어 초록 네모: 표지가 있으면 표지, 없으면 음표
  function showArt(url) {
    el.npArt.classList.toggle("has-img", !!url);
    el.npArtImg.classList.toggle("hidden", !url);
    if (url) el.npArtImg.src = url; else el.npArtImg.removeAttribute("src");
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
    rebuildOrder();   // 끄면 원래 순서로 (지금 곡은 그대로)
    saveQueue();
  }
  // 섞기 켜기/끄기를 정하고 하단 섞기 아이콘도 맞춤 (큐는 부르는 쪽에서 새로 만듦)
  function setShuffle(on) {
    if (state.shuffle === on) return;
    state.shuffle = on; store.set("shuffle", on);
    el.btnShuffle.classList.toggle("active", on);
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
  function updateMediaSession(t, art = state.arts.get(t.id)) {
    if (!("mediaSession" in navigator)) return;
    const g = t.tags || {};
    const artwork = art ? [{ src: art, sizes: "512x512" }]
      : [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: dispTitle(t), artist: g.artist || t.folderName || "", album: g.album || (state.folder && state.folder.name) || "", artwork,
    });
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
  el.btnFolder.onclick = () => showFolderPicker();
  let refreshTimer = null, refreshLong = false;
  el.btnRefresh.addEventListener("pointerdown", () => {
    refreshLong = false; clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshLong = true;
      retagAll();
    }, 700);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.btnRefresh.addEventListener(ev, () => clearTimeout(refreshTimer));
  el.btnRefresh.addEventListener("contextmenu", (e) => e.preventDefault());
  el.btnRefresh.onclick = () => { if (refreshLong) { refreshLong = false; return; } if (state.folder) openFolder(state.folder); };
  el.btnFolderSearch.onclick = searchFolders;
  el.folderQ.addEventListener("keydown", (e) => { if (e.key === "Enter") searchFolders(); });
  el.libQ.addEventListener("input", renderLib);
  el.libQ.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { if (e.key === "Escape") { el.libQ.value = ""; renderLib(); } el.libQ.blur(); } });
  el.btnPlay.onclick = togglePlay;
  el.btnNext.onclick = next;
  el.btnPrev.onclick = prev;
  el.btnShuffle.onclick = toggleShuffle;
  el.btnRepeat.onclick = cycleRepeat;
  el.btnFav.onclick = toggleFav;

  // 보관함 분류
  el.libKinds.onclick = (e) => {
    const b = e.target.closest("button[data-kind]"); if (!b) return;
    setLibView(b.dataset.kind);
    mainEl.scrollTop = 0;
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  el.btnGroupBack.onclick = () => { setLibView(state.libView.kind); mainEl.scrollTop = groupsScroll; };
  el.btnGroupPlay.onclick = () => { const g = currentGroup(); if (g) playGroup(g); };
  el.btnLibPlay.onclick = () => playVisible(false);
  el.btnLibShuffle.onclick = () => playVisible(true);

  // 플레이리스트
  el.btnBack.onclick = () => { if (el.sTags.classList.contains("show")) closeTagEditor(); else closePlaylist(); };
  el.tagKinds.onclick = (e) => {
    const b = e.target.closest("button[data-kind]"); if (!b) return;
    state.tagEdKind = b.dataset.kind; store.set("tagedkind", state.tagEdKind);
    el.tagsQ.value = ""; mainEl.scrollTop = 0;
    renderTagEditor();
  };
  el.tagsQ.addEventListener("input", renderTagEditor);
  el.tabLib.onclick = () => showTab("lib");
  el.tabPl.onclick = () => showTab("pl");
  el.btnPlNew.onclick = () => { if (createPlaylist(el.plNewName.value)) { el.plNewName.value = ""; renderPlaylistList(); } };
  el.plNewName.addEventListener("keydown", (e) => { if (e.key === "Enter") el.btnPlNew.click(); });
  el.btnPlPlay.onclick = () => playPlaylist(false);
  el.btnPlShuffle.onclick = () => playPlaylist(true);
  el.btnPlEdit.onclick = () => { state.plEditing = !state.plEditing; renderPlaylistDetail(); };
  el.btnPlRename.onclick = renamePlaylist;
  el.btnPlDelete.onclick = deletePlaylist;
  el.dim.onclick = () => { closeSheet(); closeMSheet(); };
  el.msheetCancel.onclick = closeMSheet;
  el.btnGroupEdit.onclick = () => { state.groupEditing = !state.groupEditing; state.groupChecked.clear(); renderLib(); };
  el.btnMerge.onclick = () => {
    const groups = buildGroups(state.libView.kind).filter((g) => state.groupChecked.has(g.key));
    if (groups.length >= 2) openMerge(groups);
  };
  el.btnLibMenu.onclick = openLibMenu;
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
    const lv = store.get("libview", null);
    if (lv && (lv.kind === "songs" || KINDS[lv.kind])) state.libView = { kind: lv.kind, group: lv.group == null ? null : String(lv.group) };
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
