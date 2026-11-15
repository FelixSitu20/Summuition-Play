"""Verify only the expressly authorized owner pilot; never school approval."""
import hashlib,json,gzip
from pathlib import Path,PurePosixPath
root=Path(__file__).resolve().parents[1]/'guest/pilots'
name='connection-20261115-b7e2'
assert {p.name for p in root.iterdir()}=={name}, 'Unexpected pilot paths'
site=root/name
assert not any(p.is_symlink() for p in root.rglob('*'))
manifest_path=site/'publication-manifest.json'
assert hashlib.sha256(manifest_path.read_bytes()).hexdigest()=='30d3b4ce04bb724997186388d74adaf98428563578ca6bc21fef9cf4d72aa14a', 'Pilot manifest differs from reviewed package'
m=json.loads(manifest_path.read_text())
assert m['channel']=='owner-connectivity-pilot' and m['access']=='public-unlisted-not-private'
assert m['schoolApproval'] is False and m['releaseReady'] is False and m['phonePcVerified'] is False
entries=m['files']+m['hostFiles']
expected={e['path'] for e in entries}|{'publication-manifest.json'}
assert len(expected)==len(entries)+1
assert {p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file()}==expected
for e in entries:
    r=PurePosixPath(e['path']);assert not r.is_absolute() and '..' not in r.parts and '\\' not in str(r)
    data=(site/r).read_bytes();assert hashlib.sha256(data).hexdigest()==e['sha256'],e['path']
    assert len(data)<100*1024*1024
    if str(r).endswith('.unityweb'):
        raw=gzip.decompress(data);assert raw
        if '.wasm.' in str(r):assert raw.startswith(b'\x00asm')
bridge=(site/'game/summuition-peer/unity-peer-bridge.mjs').read_text()
assert 'https://summuition-rendezvous.summuition-rendezvous.workers.dev' in bridge
assert 'stun:stun.cloudflare.com:3478' in bridge
assert 'useRelay: true' in bridge
html=(site/'game/index.html').read_text()
assert 'sessionGate' not in html and 'SummSessionControl' not in html
assert 'Turn your phone sideways' in html and 'devicePixelRatio:renderPixelRatio' in html
assert 'Not approved for student use' in (site/'index.html').read_text()
print('PASS isolated public-unlisted owner pilot: exact reviewed hashes, real game, mobile wrapper, explicit non-school status.')
