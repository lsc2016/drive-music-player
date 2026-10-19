# Drive Music — Claude Code 작업 지침

구글 드라이브를 파일 저장소로 쓰는 음악 플레이어 웹앱. 맥 브라우저와 휴대폰 브라우저 둘 다에서 씀.

## 구조 (파일 3개가 전부, 빌드 도구 없음)
- `index.html` — 화면과 스타일(CSS는 이 파일 안에 있음). 화면 3개: 로그인 `#s-login`, 폴더 고르기 `#s-folder`, 재생목록 `#s-tracks`. 하단 고정 플레이어 `#player`.
- `app.js` — 모든 동작. 즉시실행함수 하나 안에 섹션별로 나뉘어 있음: 로그인(토큰) → 드라이브 API → 폴더 화면 → 재생목록 화면 → 재생 순서 → 파일 받기 → 재생 제어 → Media Session → 이벤트 → 시작.
- `config.js` — 사용자가 손대는 설정 (`CLIENT_ID`, `DEFAULT_FOLDER_NAME` 기본 "Music", `INCLUDE_SUBFOLDERS`). 코드에서는 `window.APP_CONFIG`로 읽음.
- `icons/`(icon-32·180·192·512.png, 초록 정사각형 + 흰 음표) + `manifest.json` — "홈 화면에 추가"용 앱 아이콘·이름. `index.html` `<head>`에서 연결, 경로는 GitHub Pages 하위 경로 때문에 전부 상대경로. 아이콘을 바꾸면 PNG 네 개를 같이 다시 만들기(`sips`로 SVG→PNG).
- `serve.sh` — 로컬 실행 (`python3 -m http.server 8000`). `README.md` — 사용자용 설치·사용 안내(구글 클라이언트 ID 발급 순서 포함).

## 동작 방식 (바꿀 때 알아둘 것)
- 로그인: Google Identity Services 토큰 클라이언트(`initTokenClient`), scope `drive.readonly`. 토큰은 1시간짜리라 `sessionStorage`에 두고, 만료·401이면 `prompt:""`로 조용히 재발급. 리디렉션 URI 없음 → 구글 콘솔에는 "승인된 JavaScript 원본"만 등록.
- 첫 화면: `afterLogin()` → 기억된 폴더(`dm:folder`)가 있으면 `openFolder(saved)`, 없으면 `openDefaultFolder()` = `findFolderByName(CFG.DEFAULT_FOLDER_NAME)`(기본 "Music") 한 번만(q `name = 'Music' or name = 'music' or name = 'MUSIC'` — 드라이브의 `=`가 대소문자를 가려서 흔한 표기를 한 요청에 다 물음, pageSize 5, 최근 수정 순, 받은 뒤 대소문자 무시로 다시 확인) → 있으면 `openFolder(hit, {fromDefault:true})`, 없을 때만 `showFolderPicker(msg)`. 폴더 고르기 화면은 열 때 아무것도 검색 안 함(`#folder-hint` 안내만). 찾기/Enter 때만 `searchFolders()` → `listFolders(query)`: 빈 칸이면 최근 수정 20개, 이름이면 `name contains` 50개 — 둘 다 `listPage()`(첫 페이지만). 끝까지 페이지 넘기는 `listAll()`은 음악 목록(`listAudioIn`)에만. 찾기를 연달아 누르면 `folderSeq`로 마지막 결과만.
- 지워진 폴더: `openFolder`가 음악 목록과 함께 `checkFolder(folder)`(GET /files/id, 404·403·휴지통이면 `e.gone`; `driveFetch` 오류엔 `err.status`가 붙음)를 부름 → gone이면 `dm:folder`·캐시 지우고 `openDefaultFolder()`부터 다시(기본 폴더에서 온 거면 반복 막으려 폴더 고르기로).
- 곡 목록 캐시: localStorage `dm:lib:<폴더ID>` = `[id, name, size, mimeType, folderName]` 배열(태그는 안 넣음 — 태그는 `dm:library`/library.md 쪽이라 겹치지 않음), 최근 5개 폴더만(`dm:libkeys`). `openFolder`가 캐시 있으면 `setLibrary(cached)`로 먼저 그리고(이때 `loadTagDb()`의 이 기기 복사본도 이미 들어와 있음), 드라이브 목록이 오면 `libChanged()`면 `refreshLibrary()`(듣던 곡·받아둔 파일 유지, 목록만 교체), 같으면 `attachTags()`+`renderLib()`. 그새 다른 폴더를 열면 `state.openSeq`로 늦은 결과 버림. 로그아웃하면 캐시와 기억된 폴더(`dm:folder`)를 지움 → 다음 로그인은 기본 폴더 찾기부터.
- 파일 목록: Drive v3 `files.list`, 폴더를 BFS로 돌며 `mimeType contains 'audio/'` 또는 확장자(`AUDIO_EXT`)로 거름. 폴더명→파일명 순 정렬(`Intl.Collator ko, numeric`).
- 재생: `<audio>`는 헤더를 못 붙이므로 `alt=media`로 fetch → Blob → `URL.createObjectURL`. 받아둔 파일은 `state.blobUrls`에 최근 6곡까지, 다음 곡은 `prefetchNext()`로 미리 받음. (스트리밍이 아니라 통째로 받은 뒤 재생.)
- 기억: `localStorage` 키 `dm:folder`, `dm:last:<folderId>`, `dm:shuffle`, `dm:repeat`, `dm:lib:<folderId>`(곡 목록 캐시).
- 섞기는 `state.order`(인덱스 배열)만 섞고 `state.tracks`는 그대로 둠. 현재 곡 위치는 `state.pos`(order 기준).
- 곡 출처 두 가지: `state.library`(폴더 전체 곡)와 `state.playlists`. 실제 재생 큐는 `state.tracks` + `state.source`(`{type:"library"}` 또는 `{type:"playlist", name}`)이고, `setQueue()`로 바꿈. 폴더 새로고침은 라이브러리만 갈고 플레이리스트 재생 중이면 큐를 건드리지 않음.
- 플레이리스트 저장: 드라이브 루트의 `drive-music-playlists.md`(상수 `PL_FILE`). `serializePlaylists`/`parsePlaylists`가 `## 이름` + `- 제목 | 파일ID | 폴더` 형식을 읽고 씀. 바꾸면 `savePlaylists()` → localStorage 즉시 + 1.2초 뒤 `flushPlaylists()`로 드라이브 업로드(처음엔 multipart 생성, 이후 PATCH media). 이 때문에 scope에 `drive.file` 추가됨. `즐겨찾기`(상수 `FAV`)는 ♥ 버튼용 기본 플레이리스트.
- 화면: 재생목록 화면에 탭(보관함 / 플레이리스트), 플레이리스트 상세는 별도 화면 `#s-pl`(뒤로 버튼으로 복귀), 담기는 바텀시트 `#sheet`. 곡 한 줄은 `trackRow()`가 공통으로 만듦.
- 보관함 분류: 탭 아래 `#lib-kinds`(곡 | 아티스트 | 앨범 | 작곡가 | 장르 | 언어, 가로 스크롤). `state.libView = {kind, group}`(kind "songs"|"artist"|"album"|"composer"|"genre"|"language", group은 묶음 key) → localStorage `dm:libview`로 기억. `renderLib()`가 분류에 맞춰 그림: "songs"면 `renderTracks()`(예전 목록 그대로, `#track-list`), 나머지는 `#lib-groups` 안 `#group-list`에 `renderGroupNames()`(이름 목록) 또는 `renderGroupDetail()`(그 묶음의 곡, `#group-head`의 ‹ 로 복귀). 묶기는 `buildGroups(kind)`/`groupKey()` — 분류별 이름·단위는 `KINDS`. 앨범 key는 `앨범\u0001앨범아티스트`(같은 이름 다른 앨범 구분), 두 번째 줄은 앨범아티스트 → 아티스트가 하나면 그 이름 → 여럿이면 "여러 아티스트". 태그가 빈 곡(`untagged()`: 아티스트 없음 + 제목=파일명 + 앨범=폴더명)은 key "" → "알 수 없는 …"으로 맨 아래. 정렬 `libColl`(ko, numeric), 앨범 안은 `byTrack`, 나머지는 앨범→트랙. 곡·▶·재생을 누르면 `playGroup()` → `setQueue({type:"group", kind, key, name}, tracks)`, 하단 작은 글씨 "♪ 이름"(아티스트 묶음이면 아티스트 이름 생략). 태그 읽기가 끝나면 분류 화면 다시 그림.
- 검색: 보관함 탭 `#lib-q`. "곡"에선 `renderTracks()`가 `matchTrack()`(제목(태그·파일명)·아티스트·앨범·폴더명, 공백·대소문자 무시)로 거름, 이름 목록에선 이름, 묶음 안에선 `matchTrack()`. 보기만 거르고 재생 큐(`state.tracks`)는 전체 곡 그대로 — 번호·`playIndex(i)`도 전체 곡 기준. 다른 폴더로 가면 검색어 비움(새로고침은 유지).

- 태그: CDN의 jsmediatags 3.9.5(`index.html`에 `<script src>` 한 줄, integrity 있음 — 버전 바꾸면 해시도 같이)로 읽음. `state.library` 각 곡에 `tags: {title, artist, album, albumArtist, composer, genre, track, year, hasArt}`. 화면 제목은 `dispTitle(t)`, 부제는 `tagSub(t)`("아티스트 · 앨범", 앨범이 폴더명뿐이면 생략) 없으면 파일 크기. 태그 없거나 못 읽으면 `fallbackTags()` = 파일명·폴더명.
- 태그 읽기는 파일 일부만 받음: `remoteFile(t).getAt(위치, 길이, exact)`가 Range 요청(`driveFetch`에 `Range` 헤더)으로 조각을 받아 이어 붙임. `tagBlobOf()`가 형식별로 태그 부분만 Blob으로 만듦 — mp3는 ID3v2 머리의 길이만큼(없으면 끝 128바이트 ID3v1), flac은 메타데이터 블록 끝까지(작곡가·앨범아티스트·연도는 jsmediatags가 안 줘서 `flacComments()`로 직접), m4a는 맨 위 `ftyp`+`moov`만 이어 붙인 작은 파일(moov가 끝에 있어도 그 자리만 받음). 첫 요청은 m4a·flac 1MB, 그 외 128KB. 옛 한국 mp3의 EUC-KR 태그는 `fixKo()`로 다시 풂. `scanTags(all)`가 동시에 `TAG_WORKERS`(4)곡씩, `state.scanId`로 폴더 바뀌면 멈춤. 진행은 `#tag-progress`.
- 보관함 저장: 드라이브 루트 `drive-music-library.md`(상수 `LIB_FILE`). 한 줄 `- 파일ID | 제목 | 아티스트 | 앨범 | 앨범아티스트 | 작곡가 | 장르 | 트랙 | 연도 | 폴더`(`serializeLibrary`/`parseLibrary`, 모든 폴더 곡이 한 파일에). `state.tagDb`(Map, 파일ID→{tags, folderName})가 내용. 폴더 열 때 `loadTagDb()` 먼저(한 번만) → 보관함에 없는 곡만 `scanTags()`. 25곡마다·끝날 때 `flushLibrary()`(겹치지 않게 `libSaving`), 업로드는 플레이리스트와 같이 `uploadMd()`(처음 multipart, 이후 PATCH). localStorage `dm:library`에도 복사.
- 표지: 저장 안 함. `hasArt`도 파일엔 없어서 보관함에서 읽은 곡은 `null`(모름). 재생할 때 `loadArt()`가 받아둔 Blob을 jsmediatags로 다시 읽어 `state.arts`(최근 12곡 objectURL)에 → `#np-art-img`, Media Session artwork(없으면 `icons/icon-512.png`).
- 새로고침 버튼: 클릭 = `openFolder(folder)`(새 곡만), 0.7초 길게 누르기 = `retagAll()`(전부 다시 — 고친 곡이 있으면 confirm으로 버릴지 물음 → `openFolder(folder, { retag: true, dropEdits })`).
- 태그 고치기(음악 파일은 절대 안 건드림, `state.tagDb` → library.md만): **edited 규칙** — 앱에서 고친 곡은 tagDb 칸에 `edited: true`, library.md 줄 끝에 ` | edited`(11번째 칸). `scanTags(all, dropEdits)`는 edited 곡을 건너뜀(all이어도). `dropEdits`(= "고친 태그도 버릴까요?" 확인)일 때만 다시 읽어 edited를 지움. 읽는 도중 고친 곡도 덮지 않음. edited 곡은 `untagged()`가 false(알 수 없음으로 안 묶음). 고칠 땐 `ensureEntry(t)`(아직 안 읽은 곡이면 칸 만듦) → 값 바꾸고 → `afterLibEdit()`(= `saveLibrary()` 1.2초 뒤 `flushLibrary()` + 분류·플레이리스트·하단 플레이어 다시 그림).
- 묶음 합치기/이름 바꾸기: 이름 목록 `#btn-group-edit`(편집) → `state.groupEditing`, 체크는 `state.groupChecked`(key), 2개 이상이면 `#btn-merge` → `openMerge(groups)`. 마우스(`canDrag`: hover+fine pointer)면 편집 아닐 때 줄 HTML5 drag&drop → 놓은 줄이 기본 선택. 편집 중 ✎·길게 누르기 → `openRename(g)`. 둘 다 `retagGroups(kind, groups, name, albumArtist)` — 앨범은 앨범아티스트도 고른 묶음 것으로 맞춤, 듣던 묶음이면 `state.source` 이름도 갱신.
- 곡 ⋯(`trackRow`의 `onMore`) → `openTrackMenu()` → `openTagForm()`(`TAG_FIELDS`, `<datalist id="dl-artist|album|genre|composer">`는 `fillDatalists()`가 tagDb 값으로 채움).
- 되돌리기: 고치기·전부 다시 읽기 직전 `rememberUndo(label)`가 library.md 전체 텍스트를 localStorage `dm:libundo`에 한 벌(한 단계만). `undoLast()`가 그걸 `parseLibrary`해서 tagDb 통째로 갈고 저장. 토스트 버튼(`toast(msg, {label, fn})`, 5초)·보관함 머리 ⋯(`openLibMenu()`)에서 부름.
- 언어 태그: `tags.language`, 값은 `LANGS`(한국어·중국어·영어·일본어·기타) 다섯 개만. `detectLang(title, artist)`가 글자 모양으로 짐작(한글 → 가나 → 한자 → 로마자 → 기타 순). 태그 읽을 때(`pickTags`·`fallbackTags`) 채우고, 언어 칸 없는 예전 보관함 줄은 `attachTags()`가 열 때 채워 저장. 곡 태그 편집 폼에선 `<select>`, 제목·아티스트를 고치면 직접 고르기 전까지 따라 바뀜. 이름 바꾸기도 select, 합치기 창에 "새 이름" 없음. 보관함 분류(`KINDS.language`)는 LANGS 순서로 정렬.
- library.md 줄 모양: `- 파일ID | 제목 | 아티스트 | 앨범 | 앨범아티스트 | 작곡가 | 장르 | 트랙 | 연도 | 폴더 | 언어 [| edited]`. `parseLibrary`는 끝의 edited → 언어(LANGS 값 또는 빈칸, 칸이 10개 이상일 때만) 순으로 떼어냄 — 언어 칸 없는 예전 줄도 그대로 읽힘.
- 태그 목록 편집 화면 `#s-tags`(보관함 ⋯ 메뉴 → `openTagEditor()`, 헤더 ← 는 `closeTagEditor()`): `#tag-kinds`로 종류 고름(`dm:tagedkind` 기억), `renderTagEditor()`가 `buildGroups(kind)` 값 목록. 줄마다 ✎(`openRename`)와 ≡(`.grip`). 끌기는 HTML5 drag가 아니라 pointer 이벤트(`startTagDrag`: setPointerCapture, 떠다니는 복사본 `.dragghost`, `elementFromPoint`로 아래 줄 찾기, 끝 근처면 `mainEl` 자동 스크롤) — 손가락·마우스 둘 다. 놓으면 `openDropMerge(src, dst)`: 남길 이름 둘 중 고르기, "N곡 바뀜" 표시 → `retagGroups(kind, [바뀌는 쪽만], 이름)`라 실제로 바뀐 곡에만 edited가 붙음. 고친 뒤 `afterLibEdit()`가 이 화면도 다시 그림.
- 바텀시트 두 개: `#sheet`(플레이리스트 담기, 예전 그대로), `#msheet`(만능: `openMSheet({title, sub, body, ok})` — 메뉴·합치기·이름 바꾸기·태그 편집).

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
