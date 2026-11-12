"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/1cec2071820252c00cc385dfea2f5c4c.framework.js.unityweb': '3a3674fcc97f754efdf6819f3d12d936a0858c51c8dc5bfc7a91f7394ad900ce',
 'game/Build/4fe2c969c73ee0435399ca2bb01fd860.wasm.unityweb': '46868cc2f6805d5538fc3ce6fa3136642f483e79fea6fca58c3397ce02f02318',
 'game/Build/92d40ba8ea3e97090d1856cabf70c783.data.unityweb': 'bdb1da2fda248c7969dc8bd6eef60ba3c877fe7b965a89be6ae1de5f153baf91',
 'game/Build/b563bb5d68040dafde396014bcc16fc2.loader.js': '17d1d89a562906b4852deda73b103b97c669b7599a1613bd51245b68848e1fd4'}
expected_files = set(expected_builds) | {'index.html', 'game/index.html', 'robots.txt', '.nojekyll', 'publication-manifest.json', 'session-control.js', 'session-ended.html'}
expected_dirs = {'game', 'game/Build'}
assert all(not p.is_symlink() for p in root.rglob('*')), 'Symlinks are not allowed'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()} == expected_files
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_dir()} == expected_dirs
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
assert manifest['contentAuditSha256'] == '62e833ff5d147e71a6544d1ad481b765961abe7397491c9f06e0df416ac88ffd'
entries = manifest['files']
assert len(entries) == len(expected_files) - 1
assert {e['path'] for e in entries} == expected_files - {'publication-manifest.json'}
for entry in entries:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
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
loader = (root / 'game/Build/b563bb5d68040dafde396014bcc16fc2.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no external hosting redirect or UI, mobile wrapper, and gzip/WebAssembly integrity.')
