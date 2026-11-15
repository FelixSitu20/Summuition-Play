"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/45602152548a1daf81bc496ec1e62b6a.data.unityweb': '7e9df258b30da152c0829bbb26e570f4f591d2d29709bcc0bc7cd62b390f62e2', 'game/Build/882bb2615940bf746a5874873d1a55d8.loader.js': 'cf7afd837484d527be7b8721ce69eb8dd40e78d35180a64b4e696ef36673fe32', 'game/Build/aabb7729bbfda26183ed117f45aeb44e.wasm.unityweb': '21c6a85b2e6cb80b5294e382876ca364fd74201f5af4036ecf91a8643b9d8585', 'game/Build/b034a33a55d600964f959ff72a72632c.framework.js.unityweb': '64ea2133ca3fbf8fad7993b8cea71fe03fcb09c58ca78f9213682e00efea6757'}
expected_peers = {'game/summuition-peer/engine.mjs': '8eee600ac1ad074e46b77a69266509145a0e88a9aad5ca0d504e060bb733c0d4', 'game/summuition-peer/math.mjs': '171a5a7a3dad3b258c99a3cd7b63844dbd4cfa491cbec2da21696e0b6947eacf', 'game/summuition-peer/puzzles.json': 'a84987d228c9664a2d6d3ffb36d971bb3a69d57f5932f9f6c02ba98276aa1c1a', 'game/summuition-peer/transport.mjs': 'ae5be3ea31f3e1611cb1f15359d441969cf2806f4bc9d4d58bc5775210a6549c', 'game/summuition-peer/unity-peer-bridge.mjs': '3499bc53d126a4cf0b8499a220d9e2533e37d1c1c929aff65e31b70998a82ca6'}
expected_files = set(expected_builds) | set(expected_peers) | {'index.html', 'game/index.html', 'robots.txt', '.nojekyll', 'publication-manifest.json', 'session-control.js', 'session-ended.html'}
expected_dirs = {'game', 'game/Build', 'game/summuition-peer'}
assert all(not p.is_symlink() for p in root.rglob('*')), 'Symlinks are not allowed'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and 'pilots' not in p.relative_to(root).parts} == expected_files
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_dir() and 'pilots' not in p.relative_to(root).parts} == expected_dirs
manifest = json.loads((root / 'publication-manifest.json').read_text())
assert manifest['product'] == 'Summuition'
assert manifest['channel'] == 'public-guest-test'
assert manifest['publicationMode'] == 'public-guest-direct'
assert manifest['access'] == 'public-no-authentication'
assert manifest['schoolAuthentication'] is False
assert manifest['onlineCompetition'] is False
assert manifest['payloadContainsUnitySource'] is False
assert manifest['publicUrl'] == base
assert manifest['gameUrl'] == base + 'game/'
assert manifest['hostDisplayValidation']['compiledGameUnchanged'] is False
assert manifest['hostDisplayValidation']['rebuiltPlayerAudited'] is True
assert manifest['contentAuditSha256'] == '1fcbd719a1194aa3ab90ff64de2650fd119dbd011310a456d3123d6b23996db9'
entries = manifest['files']
assert len(entries) == len(expected_files) - 1
assert {e['path'] for e in entries} == expected_files - {'publication-manifest.json'}
for entry in entries:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
    if entry['path'] in expected_peers:
        assert entry['sha256'] == expected_peers[entry['path']], entry['path']
    if entry['path'] in expected_builds:
        assert entry['sha256'] == expected_builds[entry['path']], entry['path']
assert sum((root / f).stat().st_size for f in expected_files) < 20 * 1024 * 1024
assert (root / '.nojekyll').read_bytes() == b''

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.tags = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        assert attrs.get('http-equiv', '').lower() != 'refresh'
        for key in ('href', 'src', 'action'):
            if key in attrs:
                self.refs.append(attrs[key])

for name in ('index.html', 'game/index.html', 'session-ended.html'):
    html = (root / name).read_text()
    assert 'chatgpt' not in html.lower()
    if name != 'game/index.html':
        assert 'window.location' not in html
    else:
        assert html.count('window.location') == 1
        assert "window.location.replace('../session-ended.html?reason='+encodeURIComponent(reason));" in html
        assert '<script src="../session-control.js"></script>' in html
        assert 'onAllowed:startGame' in html
    assert '<iframe' not in html.lower()
    page = Links()
    page.feed(html)
    for ref in page.refs:
        resolved = urlsplit(urljoin(base + name, ref))
        assert resolved.netloc == 'felixsitu20.github.io'
        assert resolved.path.startswith('/Summuition-Play/')
    if name == 'index.html':
        assert page.refs == ['game/']
        assert 'School sign-in is not enabled.' in html
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == manifest['hostPresentation']['sha256']
    elif name == 'game/index.html':
        for file in expected_builds:
            assert "'" + file.removeprefix('game/') + "'" in html
        assert 'devicePixelRatio:renderPixelRatio' in html
        assert 'Turn your phone sideways' in html
        assert 'requestFullscreen' in html

control = (root / 'session-control.js').read_text()
assert 'https://raw.githubusercontent.com/FelixSitu20/' in control
assert 'statusUrlFor(scriptUrl)' in control
assert "credentials:'omit'" in control and "cache:'no-store'" in control
assert "redirect:'error'" in control
assert 'Play continues while we retry.' in control
assert not any(secret in control for secret in ('Authorization', 'ghp_', 'github_pat_'))
assert manifest['sessionControl']['repositoryId'] == 1450788815
assert manifest['sessionControl']['accessControl'] is False

# Unity's built-in fallback handles its gzip payload without custom response headers.
for file in expected_builds:
    if file.endswith('.unityweb'):
        unpacked = gzip.decompress((root / file).read_bytes())
        assert unpacked
        if '.wasm.' in file:
            assert unpacked.startswith(b'\x00asm')
loader = (root / 'game/Build/882bb2615940bf746a5874873d1a55d8.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no external hosting redirect or UI, mobile wrapper, and gzip/WebAssembly integrity.')
