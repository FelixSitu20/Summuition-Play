"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/01930e1a648d25a0ae44e06207cdbe94.framework.js.unityweb': 'f411484669179a06a61fa5ebae592b12c9d940a74d7ceedc5eaf4706c649e560',
 'game/Build/91643ecd044cb6df69560ef6c1495535.wasm.unityweb': '21b920d978f091140c94d29e19cfd2e8cf0e9aa581eb85dec827197234c0af88',
 'game/Build/9e807b12ae1919b75ddfacdeefc9b0b5.loader.js': '18337dbfa5400c98b6eb47f5eac827bf114a69663e3599b7166d6523b202995c',
 'game/Build/be6dcb69ebc70856fe607123d9cdfd4f.data.unityweb': '9884073206ba28ed331e3911894923d7d390288561d03578742017cad4afc3b9'}
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
assert manifest['contentAuditSha256'] == 'e8f54d62a139bb4f49735c7adadbb6a369fd8cea198943b627e2284ce7c82997'
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
loader = (root / 'game/Build/9e807b12ae1919b75ddfacdeefc9b0b5.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no redirect or hosting UI, mobile wrapper, and gzip/WebAssembly integrity.')
