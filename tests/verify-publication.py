"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/01930e1a648d25a0ae44e06207cdbe94.framework.js.unityweb': '93653abe0f055bb4007baecbb4a342209da0f3fcbbb9c31b25933dbff369bed7',
 'game/Build/05e19ab93c8485038378d3a4c825128b.loader.js': 'bcd17cf3246ef56579ab0ae161132bd7904498e931fcaa8c0463b12f8c586cbc',
 'game/Build/1f6e1749760843601f4f180f511a47df.data.unityweb': '5b9aff57d104006e09415cb173264dd6a656a6fe07311bb5f5f4a2b125ce960c',
 'game/Build/be7b4ec9981aff7dcc5a293902d5c6fe.wasm.unityweb': '54e5498e3758371b4390b946ae06eb82decd34fb70b73abbeb8f31a597c4dd77'}
expected_files = set(expected_builds) | {'index.html', 'game/index.html', 'robots.txt', '.nojekyll', 'publication-manifest.json'}
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
assert manifest['contentAuditSha256'] == 'c00a6b3e49c74707d45d2f4ce3a9d9d45596a7e12c81facf3e2098265af706b2'
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

for name in ('index.html', 'game/index.html'):
    html = (root / name).read_text()
    assert 'chatgpt' not in html.lower()
    assert 'window.location' not in html
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
    else:
        for file in expected_builds:
            assert "'" + file.removeprefix('game/') + "'" in html
        assert 'devicePixelRatio:renderPixelRatio' in html
        assert 'Turn your phone sideways' in html
        assert 'requestFullscreen' in html

# Unity's built-in fallback handles its gzip payload without custom response headers.
for file in expected_builds:
    if file.endswith('.unityweb'):
        unpacked = gzip.decompress((root / file).read_bytes())
        assert unpacked
        if '.wasm.' in file:
            assert unpacked.startswith(b'\x00asm')
loader = (root / 'game/Build/05e19ab93c8485038378d3a4c825128b.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no redirect or hosting UI, mobile wrapper, and gzip/WebAssembly integrity.')
