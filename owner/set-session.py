"""GitHub-authenticated online session switch. No credentials in this file or payload."""
from __future__ import annotations
import datetime as dt
import json
import os
import re
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid

OWNER = 'FelixSitu20'
REPOSITORY_ID = '1450788815'
CONTROL_REF = 'refs/heads/session-control'

def runtime_repository() -> str:
    repository = os.environ.get('GITHUB_REPOSITORY', '')
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('GITHUB_REPOSITORY_ID') != REPOSITORY_ID or
            os.environ.get('GITHUB_REPOSITORY_OWNER') != OWNER or
            os.environ.get('GITHUB_ACTOR') != OWNER or
            os.environ.get('GITHUB_TRIGGERING_ACTOR') != OWNER or
            not re.fullmatch(re.escape(OWNER) + r'/[A-Za-z0-9_.-]+', repository)):
        raise RuntimeError('Run this switch as its owner from the authorized repository Actions page.')
    return repository


def make_record(action: str, minutes: str = '0', now: dt.datetime | None = None) -> dict:
    if action not in ('STOP', 'OPEN'):
        raise ValueError('Choose STOP or OPEN.')
    try:
        duration = int(minutes or '0') if action == 'OPEN' else 0
    except ValueError as exc:
        raise ValueError('Minutes must be a whole number from 0 to 240.') from exc
    if not 0 <= duration <= 240:
        raise ValueError('Minutes must be from 0 to 240; 0 means no automatic end.')
    current = now or dt.datetime.now(dt.timezone.utc)
    return {'schema': 1, 'enabled': action == 'OPEN', 'sessionId': str(uuid.uuid4()),
            'updatedAt': current.isoformat(timespec='seconds'),
            'closesAt': (current + dt.timedelta(minutes=duration)).isoformat(timespec='seconds')
            if action == 'OPEN' and duration else None}


def git(cwd: Path, *args: str, input_text: str | None = None) -> str:
    env = dict(os.environ)
    env.update(GIT_AUTHOR_NAME='Summuition play switch',
               GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com',
               GIT_COMMITTER_NAME='Summuition play switch',
               GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')
    result = subprocess.run(['git', '-C', str(cwd), *args], input=input_text.encode('utf-8') if input_text is not None else None,
                            capture_output=True, timeout=90, env=env)
    if result.returncode:
        error = result.stderr.decode('utf-8', errors='replace').strip()
        raise RuntimeError(f'Git {args[0]} failed: {error}')
    return result.stdout.decode('utf-8').strip()


def publish(cwd: Path, record: dict) -> str:
    # Only the control branch is touched. Never force-push or change the checked-out tree.
    remote = git(cwd, 'ls-remote', '--heads', 'origin', CONTROL_REF)
    parent = None
    if remote:
        git(cwd, 'fetch', '--no-tags', 'origin', CONTROL_REF)
        parent = git(cwd, 'rev-parse', 'FETCH_HEAD')
    payload = json.dumps(record, indent=2) + '\n'
    blob = git(cwd, 'hash-object', '-w', '--stdin', input_text=payload)
    tree = git(cwd, 'mktree', input_text=f'100644 blob {blob}\tsession.json\n')
    args = ['commit-tree', tree]
    if parent:
        args += ['-p', parent]
    action = 'OPEN' if record['enabled'] else 'STOP'
    commit = git(cwd, *args, input_text=f'{action} supervised Summuition play\n')
    git(cwd, 'push', 'origin', f'{commit}:{CONTROL_REF}')
    # Remote acceptance is checked separately from CDN visibility.
    actual = git(cwd, 'ls-remote', '--heads', 'origin', CONTROL_REF).split()[0]
    if actual != commit:
        raise RuntimeError('The control branch changed again. Check the latest run before retrying.')
    return commit


def visible(record: dict, repository: str, attempts: int = 12) -> bool:
    for attempt in range(attempts):
        url = 'https://raw.githubusercontent.com/' + repository + '/session-control/session.json?check=' + str(uuid.uuid4())
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                     'User-Agent': 'Summuition-play-switch'})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                actual = json.load(response)
            if actual == record:
                return True
        except (OSError, ValueError):
            pass
        if attempt + 1 < attempts:
            time.sleep(3)
    return False


def main() -> None:
    repository = runtime_repository()
    record = make_record(os.environ.get('SUMM_ACTION', ''), os.environ.get('SUMM_MINUTES', '0'))
    cwd = Path(os.environ['GITHUB_WORKSPACE'])
    commit = publish(cwd, record)
    action = 'OPEN' if record['enabled'] else 'STOP'
    pending_summary = (f'## Summuition: {action}\n\n'
                       f'GitHub accepted control commit `{commit}`. Public propagation is being checked.\n\n'
                       'If this run is interrupted, inspect the control branch before retrying.\n')
    Path(os.environ['GITHUB_STEP_SUMMARY']).write_text(pending_summary, encoding='utf-8')
    print(f'{action} accepted as {commit}; checking the public status endpoint.', flush=True)
    observed = visible(record, repository)
    summary = (f'## Summuition: {action}\n\n'
               f'GitHub accepted control commit `{commit}`.\n\n'
               + ('The raw status endpoint returned the new state from this runner.\n\n' if observed else
                  '**The change is committed, but the raw status endpoint is not yet confirmed.** '
                  'Do not assume the switch has reached players.\n\n')
               + 'Other locations may see a propagation delay. Existing cached pages, direct public '
                 'build files, and downloaded or modified copies are not access-controlled.\n\n'
               + ('Automatic end: ' + str(record['closesAt']) + '\n' if record['closesAt'] else
                  'No automatic session end is scheduled.\n')
               + '\n[Open the play switch](https://github.com/' + repository + '/actions/workflows/play-switch.yml)\n')
    Path(os.environ['GITHUB_STEP_SUMMARY']).write_text(summary, encoding='utf-8')
    print(f'{action} committed as {commit}. Raw state observed: {observed}.')
    if not observed:
        raise RuntimeError('Control change committed; propagation is not yet confirmed. Check state before retrying.')


if __name__ == '__main__':
    main()