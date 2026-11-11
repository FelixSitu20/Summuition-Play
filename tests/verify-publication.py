"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/01930e1a648d25a0ae44e06207cdbe94.framework.js.unityweb': 'aeb73e34ca5f4ae12c3c4f11d1220571103e9c71ac1f601f83544fc9ad78cfa1',
 'game/Build/7dde3caca2626383dbd8d9d24c9168b8.loader.js': '965780690010f05ed0524e3868fd8e0bf33ffa17b21018dd4db094220e0419f1',
 'game/Build/a8f21063a1d02cc5cb0732ed3107e7e9.wasm.unityweb': 'a32ae1885aec550299c60cebf810bea580c696555dc180544bf6fef604b38925',
 'game/Build/bf9c4a3ce13d51421d36b8719f2bbc08.data.unityweb': '73d0f597262b158fd4f474bafbc199268c27f4675448bb7d29931d7d7034dfb2'}
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
assert manifest['contentAuditSha256'] == 'a2237c7490192d36d2d83ac201349e5ce72aef4f02aaf7cc2917b89c024d06e0'
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
loader = (root / 'game/Build/7dde3caca2626383dbd8d9d24c9168b8.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no redirect or hosting UI, mobile wrapper, and gzip/WebAssembly integrity.')
