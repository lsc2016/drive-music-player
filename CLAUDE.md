# Drive Music — Claude Code 작업 지침

구글 드라이브를 파일 저장소로 쓰는 음악 플레이어 웹앱. 맥 브라우저와 휴대폰 브라우저 둘 다에서 씀.

## 구조 (파일 3개가 전부, 빌드 도구 없음)
- `index.html` — 화면과 스타일(CSS는 이 파일 안에 있음). 화면 3개: 로그인 `#s-login`, 폴더 고르기 `#s-folder`, 재생목록 `#s-tracks`. 하단 고정 플레이어 `#player`.
- `app.js` — 모든 동작. 즉시실행함수 하나 안에 섹션별로 나뉘어 있음: 로그인(토큰) → 드라이브 API → 폴더 화면 → 재생목록 화면 → 재생 순서 → 파일 받기 → 재생 제어 → Media Session → 이벤트 → 시작.
- `config.js` — 사용자가 손대는 설정 (`CLIENT_ID`, `DEFAULT_FOLDER_NAME`, `INCLUDE_SUBFOLDERS`). 코드에서는 `window.APP_CONFIG`로 읽음.
- `icons/`(icon-32·180·192·512.png, 초록 정사각형 + 흰 음표) + `manifest.json` — "홈 화면에 추가"용 앱 아이콘·이름. `index.html` `<head>`에서 연결, 경로는 GitHub Pages 하위 경로 때문에 전부 상대경로. 아이콘을 바꾸면 PNG 네 개를 같이 다시 만들기(`sips`로 SVG→PNG).
- `serve.sh` — 로컬 실행 (`python3 -m http.server 8000`). `README.md` — 사용자용 설치·사용 안내(구글 클라이언트 ID 발급 순서 포함).

## 동작 방식 (바꿀 때 알아둘 것)
- 로그인: Google Identity Services 토큰 클라이언트(`initTokenClient`), scope `drive.readonly`. 토큰은 1시간짜리라 `sessionStorage`에 두고, 만료·401이면 `prompt:""`로 조용히 재발급. 리디렉션 URI 없음 → 구글 콘솔에는 "승인된 JavaScript 원본"만 등록.
- 파일 목록: Drive v3 `files.list`, 폴더를 BFS로 돌며 `mimeType contains 'audio/'` 또는 확장자(`AUDIO_EXT`)로 거름. 폴더명→파일명 순 정렬(`Intl.Collator ko, numeric`).
- 재생: `<audio>`는 헤더를 못 붙이므로 `alt=media`로 fetch → Blob → `URL.createObjectURL`. 받아둔 파일은 `state.blobUrls`에 최근 6곡까지, 다음 곡은 `prefetchNext()`로 미리 받음. (스트리밍이 아니라 통째로 받은 뒤 재생.)
- 기억: `localStorage` 키 `dm:folder`, `dm:last:<folderId>`, `dm:shuffle`, `dm:repeat`.
- 섞기는 `state.order`(인덱스 배열)만 섞고 `state.tracks`는 그대로 둠. 현재 곡 위치는 `state.pos`(order 기준).
- 곡 출처 두 가지: `state.library`(폴더 전체 곡)와 `state.playlists`. 실제 재생 큐는 `state.tracks` + `state.source`(`{type:"library"}` 또는 `{type:"playlist", name}`)이고, `setQueue()`로 바꿈. 폴더 새로고침은 라이브러리만 갈고 플레이리스트 재생 중이면 큐를 건드리지 않음.
- 플레이리스트 저장: 드라이브 루트의 `drive-music-playlists.md`(상수 `PL_FILE`). `serializePlaylists`/`parsePlaylists`가 `## 이름` + `- 제목 | 파일ID | 폴더` 형식을 읽고 씀. 바꾸면 `savePlaylists()` → localStorage 즉시 + 1.2초 뒤 `flushPlaylists()`로 드라이브 업로드(처음엔 multipart 생성, 이후 PATCH media). 이 때문에 scope에 `drive.file` 추가됨. `즐겨찾기`(상수 `FAV`)는 ♥ 버튼용 기본 플레이리스트.
- 화면: 재생목록 화면에 탭(전체 곡 / 플레이리스트), 플레이리스트 상세는 별도 화면 `#s-pl`(뒤로 버튼으로 복귀), 담기는 바텀시트 `#sheet`. 곡 한 줄은 `trackRow()`가 공통으로 만듦.
- 검색: "전체 곡" 탭 맨 위 `#lib-q`. `renderTracks()`가 입력값으로 제목(태그·파일명)·아티스트·앨범·폴더명을 걸러 그림(공백·대소문자 무시). 보기만 거르고 재생 큐(`state.tracks`)는 전체 곡 그대로 — 번호·`playIndex(i)`도 전체 곡 기준. 다른 폴더로 가면 검색어 비움(새로고침은 유지).

- 태그: CDN의 jsmediatags 3.9.5(`index.html`에 `<script src>` 한 줄, integrity 있음 — 버전 바꾸면 해시도 같이)로 읽음. `state.library` 각 곡에 `tags: {title, artist, album, albumArtist, composer, genre, track, year, hasArt}`. 화면 제목은 `dispTitle(t)`, 부제는 `tagSub(t)`("아티스트 · 앨범", 앨범이 폴더명뿐이면 생략) 없으면 파일 크기. 태그 없거나 못 읽으면 `fallbackTags()` = 파일명·폴더명.
- 태그 읽기는 파일 일부만 받음: `remoteFile(t).getAt(위치, 길이, exact)`가 Range 요청(`driveFetch`에 `Range` 헤더)으로 조각을 받아 이어 붙임. `tagBlobOf()`가 형식별로 태그 부분만 Blob으로 만듦 — mp3는 ID3v2 머리의 길이만큼(없으면 끝 128바이트 ID3v1), flac은 메타데이터 블록 끝까지(작곡가·앨범아티스트·연도는 jsmediatags가 안 줘서 `flacComments()`로 직접), m4a는 맨 위 `ftyp`+`moov`만 이어 붙인 작은 파일(moov가 끝에 있어도 그 자리만 받음). 첫 요청은 m4a·flac 1MB, 그 외 128KB. 옛 한국 mp3의 EUC-KR 태그는 `fixKo()`로 다시 풂. `scanTags(all)`가 동시에 `TAG_WORKERS`(4)곡씩, `state.scanId`로 폴더 바뀌면 멈춤. 진행은 `#tag-progress`.
- 보관함 저장: 드라이브 루트 `drive-music-library.md`(상수 `LIB_FILE`). 한 줄 `- 파일ID | 제목 | 아티스트 | 앨범 | 앨범아티스트 | 작곡가 | 장르 | 트랙 | 연도 | 폴더`(`serializeLibrary`/`parseLibrary`, 모든 폴더 곡이 한 파일에). `state.tagDb`(Map, 파일ID→{tags, folderName})가 내용. 폴더 열 때 `loadTagDb()` 먼저(한 번만) → 보관함에 없는 곡만 `scanTags()`. 25곡마다·끝날 때 `flushLibrary()`(겹치지 않게 `libSaving`), 업로드는 플레이리스트와 같이 `uploadMd()`(처음 multipart, 이후 PATCH). localStorage `dm:library`에도 복사.
- 표지: 저장 안 함. `hasArt`도 파일엔 없어서 보관함에서 읽은 곡은 `null`(모름). 재생할 때 `loadArt()`가 받아둔 Blob을 jsmediatags로 다시 읽어 `state.arts`(최근 12곡 objectURL)에 → `#np-art-img`, Media Session artwork(없으면 `icons/icon-512.png`).
- 새로고침 버튼: 클릭 = `openFolder(folder)`(새 곡만), 0.7초 길게 누르기 = `openFolder(folder, { retag: true })`(전부 다시).

## 작업 원칙
- 지우고 새로 만들지 말고 있는 것에 더하고 보완하기. 파일 3개 구조와 "설정은 config.js 한 곳" 원칙 유지.
- 화면의 개념을 흐리지 않기: 주(主)는 "곡 목록 + 하단 플레이어", 폴더 바꾸기·새로고침·로그아웃은 상단 아이콘(부가 기능).
- 설명은 쉬운 말로. 전문 용어가 필요하면 생김새나 비유로 풀어서.
- 새 기능 넣으면 README의 "쓰는 법"·"자주 나오는 문제"도 맞춰 고치기.
- 검증: `node --check app.js` 후 `./serve.sh`로 열어 폰 너비(390px)에서도 깨지지 않는지 보기.

## 다음에 할 만한 것 (아직 안 함)
- 큰 파일 스트리밍(Range 요청 + MediaSource)
- 앨범·아티스트별로 묶어 보기, 트랙 번호 순 정렬 (태그는 이미 있음)
- 플레이리스트 곡 순서를 드래그로 바꾸기 (지금은 ↑↓ 버튼)
- PWA(manifest + service worker)로 홈 화면 설치·오프라인 캐시
