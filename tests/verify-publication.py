"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
expected_builds = {'game/Build/2b9b9fd1157108970ca3910ce1148fad.loader.js': 'af96ccef045bfd90d6151e9c9794a1bdf6122605e5c0ab81a73c80343fc16d99',
 'game/Build/e2a118f8a80db8fca8456478f23d4775.data.unityweb': '73acd52d7a5f14de34ef84f44586837d0dc5e97a729dcd7b2c6e515f5961d2f8',
 'game/Build/f11db4db1d7bc69f80f18bba0474d31b.framework.js.unityweb': '2fba4a7e097a8282edd67f08b413c53ad913e9b5eb167398f4cbe84241e4602c',
 'game/Build/ff72c4b0033466f63d25848b13fd94cf.wasm.unityweb': '74fc10ea1bcad8fd89771b9b0148f5bce113606b935408156954bd4f531d4d26'}
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
assert manifest['contentAuditSha256'] == '4e4b4ce7885cc9f9642ad07075a0a93980134dec1ff9e4de8fbeef00ff7b7ea7'
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
loader = (root / 'game/Build/2b9b9fd1157108970ca3910ce1148fad.loader.js').read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no external hosting redirect or UI, mobile wrapper, and gzip/WebAssembly integrity.')
