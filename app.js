/* Drive Music — 구글 드라이브를 저장소로 쓰는 음악 플레이어
 *
 * 흐름: 구글 로그인(열쇠 받기) → 폴더 고르기 → 음악 목록 → 재생
 * 파일은 드라이브에서 바로 받아와 브라우저 메모리에서만 재생합니다.
 */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  const API = "https://www.googleapis.com/drive/v3";
  const AUDIO_EXT = ["mp3", "m4a", "flac", "wav", "ogg", "aac", "opus", "wma", "aiff"];

  // ── 화면 요소 ──────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    hdrSub: $("hdr-sub"),
    btnFolder: $("btn-folder"), btnRefresh: $("btn-refresh"), btnLogout: $("btn-logout"),
    sLogin: $("s-login"), sFolder: $("s-folder"), sTracks: $("s-tracks"),
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
    tracks: [],           // [{ id, name, title, size, mimeType, folderName }]
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
    for (const s of [el.sLogin, el.sFolder, el.sTracks]) s.classList.toggle("show", s === screen);
    const signedIn = screen !== el.sLogin;
    el.btnFolder.classList.toggle("hidden", !signedIn);
    el.btnRefresh.classList.toggle("hidden", screen !== el.sTracks);
    el.btnLogout.classList.toggle("hidden", !signedIn);
    window.scrollTo(0, 0);
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
    show(el.sLogin);
    notice("로그아웃했어요.", true);
  }

  async function afterLogin() {
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
    const url = new URL(API + path);
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
    try {
      const tracks = await listAudioIn(folder);
      setTracks(tracks);
    } catch (e) {
      el.trackList.innerHTML = `<div class="notice">목록을 못 불러왔어요: ${e.message}</div>`;
    }
  }

  function setTracks(tracks) {
    // 이전에 받아둔 파일은 비움
    for (const u of state.blobUrls.values()) URL.revokeObjectURL(u);
    state.blobUrls.clear();
    state.tracks = tracks;
    rebuildOrder();
    renderTracks();
    el.tracksCount.textContent = tracks.length ? `${tracks.length}곡` : "";
    el.tracksEmpty.classList.toggle("hidden", tracks.length > 0);

    // 지난번 듣던 곡이 있으면 그 자리로 (자동 재생은 안 함 — 폰 브라우저가 막음)
    const last = store.get("last:" + state.folder.id, null);
    if (last && tracks.length) {
      const i = tracks.findIndex((t) => t.id === last.id);
      if (i >= 0) { state.pos = state.order.indexOf(i); showNowPlaying(tracks[i]); el.player.classList.add("show"); }
    }
  }

  function renderTracks() {
    el.trackList.innerHTML = "";
    const cur = currentTrack();
    let lastFolder = null;
    state.tracks.forEach((t, i) => {
      if (CFG.INCLUDE_SUBFOLDERS && t.folderName !== lastFolder && t.folderName !== state.folder.name) {
        const h = document.createElement("div");
        h.className = "sectionhead"; h.style.marginTop = "14px";
        h.innerHTML = `<h2 style="font-size:13px;color:var(--muted)"></h2>`;
        h.querySelector("h2").textContent = t.folderName;
        el.trackList.appendChild(h);
      }
      lastFolder = t.folderName;
      const b = document.createElement("button");
      b.className = "row" + (cur && cur.id === t.id ? " playing" : "");
      b.dataset.id = t.id;
      b.innerHTML = `<span class="num">${i + 1}</span>
        <div class="ic"><svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>
        <div class="t"><div class="n"></div><div class="s"></div></div>`;
      b.querySelector(".n").textContent = t.title;
      b.querySelector(".s").textContent = fmtSize(t.size);
      b.onclick = () => playIndex(i);
      el.trackList.appendChild(b);
    });
  }

  function markPlayingRow() {
    const cur = currentTrack();
    for (const r of el.trackList.querySelectorAll(".row")) r.classList.toggle("playing", !!cur && r.dataset.id === cur.id);
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
    el.npSub.textContent = t.folderName !== state.folder.name ? t.folderName : state.folder.name;
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
    state.pos = -1; state.tracks = []; state.order = [];
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
