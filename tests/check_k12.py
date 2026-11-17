from pathlib import Path
s = Path("app.js").read_text(); sw = Path("sw.js").read_text()
def body(name):
    start = s.index("function " + name + "("); begin = s.index(" {", s.index(")", start)) + 1; depth = 1; i = begin + 1
    while depth and i < len(s):
        if s[i] == "{": depth += 1
        elif s[i] == "}": depth -= 1
        i += 1
    return s[begin:i]
checks = [
    ('./api/tracks' in body('openK12') and all(x not in body('openK12') for x in ['afterLogin(', 'requestToken(', 'getToken(', 'login('])),
    (body('fetchTrackUrl').index('isDl(') < body('fetchTrackUrl').index('if (K12)')),
    ('Range: range' in body('fetchBytes') and 'fetch(k12Url(id)' in body('fetchBytes')),
    ('if (!K12) if (!tokenValid()' in body('pumpDl')),
    ('./api/data/playlists' in body('loadPlaylists') and './api/data/library' in body('loadTagDb') and 'If-Match' in body('uploadMd') and '409' in body('uploadMd')),
    ('state.offline' in body('offlineBlock') and s.count('offlineBlock()') > 10),
    ('startOffline("k12")' in body('openK12') and '받아 둔 곡이 없어서' in body('openK12')),
    (sw.index("url.pathname.includes('/api/')") < sw.index('event.respondWith') and 'dm-shell-v2' in sw),
    ('show(el.sTracks)' in body('openK12') and 'syncHash(screen)' in s and 'el.btnHome.onclick = goHome' in s),
]
for i, ok in enumerate(checks, 1): print(f"{i}: {'통과' if ok else '실패'}")
assert all(checks)
