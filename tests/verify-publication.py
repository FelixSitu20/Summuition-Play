"""Validate the exact public guest payload without including the Unity project."""
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / 'guest'
base = 'https://felixsitu20.github.io/Summuition-Play/'
# Fail closed until the publisher pins the completed, reviewed test manifest.
EXPECTED_MANIFEST_SHA256 = 'be183bd3a255293a4e9a634c2fe9a235557ae6cd7e737a982d545012145be2a8'
manifest_bytes = (root / 'publication-manifest.json').read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest() == EXPECTED_MANIFEST_SHA256, 'Unreviewed test manifest'
manifest = json.loads(manifest_bytes)
assert manifest['product'] == 'Summuition'
assert manifest['channel'] == 'connected-school-network-test'
assert manifest['access'] == 'public-session-gated-not-authentication'
for flag in ('schoolApproval', 'schoolChromebook', 'releaseReady', 'studentPlayEnabled'):
    assert manifest[flag] is False, flag
assert manifest['onlineCompetition'] is True
assert manifest['contentAuditPassed'] is True
assert manifest['sessionGatePreserved'] is True
assert manifest['schoolVerificationStatus'] == 'pending-owner-network-test'
assert manifest['pausedStatusUrl'] == 'https://raw.githubusercontent.com/FelixSitu20/Summuition-Play/session-control/session.json'
assert len(manifest['contentAuditSha256']) == 64
assert len(manifest['pausedSnapshotSha256']) == 64
entries = manifest['files'] + manifest['hostFiles']
assert len(entries) == len({e['path'] for e in entries}), 'Duplicate payload entries'
expected_builds = {e['path']: e['sha256'] for e in entries if e['path'].startswith('game/Build/')}
expected_peers = {e['path']: e['sha256'] for e in entries if e['path'].startswith('game/summuition-peer/')}
assert set(expected_peers) == {'game/summuition-peer/' + name for name in ('engine.mjs','math.mjs','transport.mjs','puzzles.json','unity-peer-bridge.mjs')}
assert len(expected_builds) == 4
for suffix in ('.loader.js','.data.unityweb','.framework.js.unityweb','.wasm.unityweb'):
    assert sum(name.endswith(suffix) for name in expected_builds) == 1
assert all(__import__('re').fullmatch(r'game/Build/[a-f0-9]+\.(loader\.js|data\.unityweb|framework\.js\.unityweb|wasm\.unityweb)', name) for name in expected_builds)
expected_fonts = {'game/TemplateData/' + name for name in ('Beholden-Regular.ttf', 'Beholden-Bold.ttf', 'Beholden-LICENSE.txt')}
assert {e['path'] for e in entries if e['path'].startswith('game/TemplateData/')} == expected_fonts
expected_files = expected_fonts | set(expected_builds) | set(expected_peers) | {'index.html', 'game/index.html', 'robots.txt', '.nojekyll', 'publication-manifest.json', 'session-control.js', 'session-ended.html'}
expected_dirs = {'game', 'game/Build', 'game/summuition-peer', 'game/TemplateData'}
assert all(not p.is_symlink() for p in root.rglob('*')), 'Symlinks are not allowed'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and 'pilots' not in p.relative_to(root).parts} == expected_files
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_dir() and 'pilots' not in p.relative_to(root).parts} == expected_dirs
assert {e['path'] for e in entries} == expected_files - {'publication-manifest.json'}
for entry in entries:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
assert sum((root / f).stat().st_size for f in expected_files) == 27989887, 'Reviewed payload byte count changed'
assert sum((root / f).stat().st_size for f in expected_files) < 32 * 1024 * 1024
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
        assert 'onDenied:endSession' in html and 'sessionGate.start()' in html
        assert 'if(!sessionGate.isActive())' in html and "endSession('unreachable')" in html
    assert '<iframe' not in html.lower()
    page = Links()
    page.feed(html)
    for ref in page.refs:
        resolved = urlsplit(urljoin(base + name, ref))
        assert resolved.netloc == 'felixsitu20.github.io'
        assert resolved.path.startswith('/Summuition-Play/')
    if name == 'index.html':
        assert page.refs == ['game/']
        assert '<details><summary>Privacy &amp; access</summary>' in html
        assert '<details open' not in html
        for text in ('For school use only', 'Summuition was created by Mr. Situ for our school. Please do not share the game or its link outside of school.', 'No account or email is needed to play. Your settings and recent games may be saved in this browser.', 'Multiplayer games use an online connection. The hosting provider may process connection information. There is no chat or friends feature.', 'Play is available only when enabled by your teacher.'):
            assert text in html
        assert 'Connected school-network TEST' not in html
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == next(e['sha256'] for e in manifest['hostFiles'] if e['path'] == name)
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
assert hashlib.sha256((root/'session-control.js').read_bytes()).hexdigest() == manifest['reviewedHostSha256']['session-control.js']

# Unity's built-in fallback handles its gzip payload without custom response headers.
for file in expected_builds:
    if file.endswith('.unityweb'):
        unpacked = gzip.decompress((root / file).read_bytes())
        assert unpacked
        if '.wasm.' in file:
            assert unpacked.startswith(b'\x00asm')
loader = (root / next(name for name in expected_builds if name.endswith('.loader.js'))).read_text()
assert 'gzip' in loader
print('PASS: exact build-only payload, all file sizes and hashes, audited rebuilt player assets, relative project paths, no external hosting redirect or UI, mobile wrapper, and gzip/WebAssembly integrity.')
