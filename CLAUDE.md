# Drive Music — Claude Code 작업 지침

구글 드라이브를 파일 저장소로 쓰는 음악 플레이어 웹앱. 맥 브라우저와 휴대폰 브라우저 둘 다에서 씀.

## 구조 (파일 3개가 전부, 빌드 도구 없음)
- `index.html` — 화면과 스타일(CSS는 이 파일 안에 있음). 화면 3개: 로그인 `#s-login`, 폴더 고르기 `#s-folder`, 재생목록 `#s-tracks`. 하단 고정 플레이어 `#player`.
- `app.js` — 모든 동작. 즉시실행함수 하나 안에 섹션별로 나뉘어 있음: 로그인(토큰) → 드라이브 API → 폴더 화면 → 재생목록 화면 → 재생 순서 → 파일 받기 → 재생 제어 → Media Session → 이벤트 → 시작.
- `config.js` — 사용자가 손대는 설정 (`CLIENT_ID`, `DEFAULT_FOLDER_NAME`, `INCLUDE_SUBFOLDERS`). 코드에서는 `window.APP_CONFIG`로 읽음.
- `serve.sh` — 로컬 실행 (`python3 -m http.server 8000`). `README.md` — 사용자용 설치·사용 안내(구글 클라이언트 ID 발급 순서 포함).

## 동작 방식 (바꿀 때 알아둘 것)
- 로그인: Google Identity Services 토큰 클라이언트(`initTokenClient`), scope `drive.readonly`. 토큰은 1시간짜리라 `sessionStorage`에 두고, 만료·401이면 `prompt:""`로 조용히 재발급. 리디렉션 URI 없음 → 구글 콘솔에는 "승인된 JavaScript 원본"만 등록.
- 파일 목록: Drive v3 `files.list`, 폴더를 BFS로 돌며 `mimeType contains 'audio/'` 또는 확장자(`AUDIO_EXT`)로 거름. 폴더명→파일명 순 정렬(`Intl.Collator ko, numeric`).
- 재생: `<audio>`는 헤더를 못 붙이므로 `alt=media`로 fetch → Blob → `URL.createObjectURL`. 받아둔 파일은 `state.blobUrls`에 최근 6곡까지, 다음 곡은 `prefetchNext()`로 미리 받음. (스트리밍이 아니라 통째로 받은 뒤 재생.)
- 기억: `localStorage` 키 `dm:folder`, `dm:last:<folderId>`, `dm:shuffle`, `dm:repeat`.
- 섞기는 `state.order`(인덱스 배열)만 섞고 `state.tracks`는 그대로 둠. 현재 곡 위치는 `state.pos`(order 기준).

## 작업 원칙
- 지우고 새로 만들지 말고 있는 것에 더하고 보완하기. 파일 3개 구조와 "설정은 config.js 한 곳" 원칙 유지.
- 화면의 개념을 흐리지 않기: 주(主)는 "곡 목록 + 하단 플레이어", 폴더 바꾸기·새로고침·로그아웃은 상단 아이콘(부가 기능).
- 설명은 쉬운 말로. 전문 용어가 필요하면 생김새나 비유로 풀어서.
- 새 기능 넣으면 README의 "쓰는 법"·"자주 나오는 문제"도 맞춰 고치기.
- 검증: `node --check app.js` 후 `./serve.sh`로 열어 폰 너비(390px)에서도 깨지지 않는지 보기.

## 다음에 할 만한 것 (아직 안 함)
- 큰 파일 스트리밍(Range 요청 + MediaSource)
- 앨범아트(ID3 태그 읽기) 표시
- 즐겨찾기/재생목록 저장 (드라이브에 `.md` 또는 `.json`으로)
- 검색(제목으로 곡 찾기)
- PWA(manifest + service worker)로 홈 화면 설치·오프라인 캐시
