/* Drive Music — 앱 껍데기(화면·코드)를 폰에 담아 두는 service worker
 *
 * 하는 일: 인터넷이 없어도 앱이 열리게 index.html·app.js·config.js·manifest.json·아이콘·jsmediatags(CDN 한 개)를 담아 둠.
 *  - 이 앱의 파일(같은 주소)은 "인터넷 먼저, 안 되면 담아 둔 것" → 고친 코드가 바로 반영됨
 *  - jsmediatags(CDN)는 버전이 박힌 주소라 "담아 둔 것 먼저"
 * 하지 않는 일:
 *  - 구글(googleapis.com · accounts.google.com) 요청은 절대 가로채거나 담지 않음 — 바로 듣기 주소엔 열쇠가 들어 있어서
 *  - 오디오는 안 거침: 받은 곡은 blob: 주소라 여기로 안 옴, Range 요청(바로 듣기)도 그냥 보냄
 * 경로는 전부 상대경로 (GitHub Pages 하위 경로 /drive-music-player/ 에서도 그 폴더 안만)
 */
const CACHE = "dm-shell-v1";
const SHELL = [
  "./", "./index.html", "./app.js", "./config.js", "./manifest.json",
  "./icons/icon-32.png", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
];
const CDN = "https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js";

// 구글 쪽 주소인지 (열쇠가 오가는 곳 — 손대지 않음)
const isGoogle = (url) => /(^|\.)googleapis\.com$/.test(url.hostname) || url.hostname === "accounts.google.com"
  || /(^|\.)google\.com$/.test(url.hostname) || /(^|\.)gstatic\.com$/.test(url.hostname);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // CDN 파일은 index.html 이 crossorigin 으로 부르므로 같은 모양(cors)으로 담아 둠. 실패해도 껍데기는 담김
    try { await cache.add(new Request(CDN, { mode: "cors", credentials: "omit" })); } catch (e) { /* 다음 접속 때 fetch 에서 담음 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("dm-shell-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isGoogle(url)) return;                  // 구글 요청: 가로채지도 담지도 않음
  if (req.headers.has("range")) return;       // 오디오 Range 요청은 브라우저가 직접
  if (url.protocol !== "https:" && url.protocol !== "http:") return;   // blob: 등

  if (url.href === CDN) {                     // 버전이 박힌 CDN 파일: 담아 둔 것 먼저
    event.respondWith(caches.match(CDN).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(CDN, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;   // 다른 곳은 손대지 않음

  // 이 앱의 파일: 인터넷 먼저(고친 코드가 바로), 안 되면 담아 둔 것. 주소 뒤 ?·# 는 무시하고 찾음
  event.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await caches.match("./index.html")) || (await caches.match("./"));
    return Response.error();
  }));
});
