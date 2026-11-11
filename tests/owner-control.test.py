"""Test the switch with disposable local Git repositories; never contacts GitHub."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('session_switch', ROOT / 'owner' / 'set-session.py')
switch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)


def git(cwd, *args):
    return subprocess.check_output(['git', '-C', str(cwd), *args], text=True).strip()


class SwitchTests(unittest.TestCase):
    def test_stop_and_open_without_automatic_end(self):
        self.assertFalse(switch.make_record('STOP')['enabled'])
        self.assertFalse(switch.make_record('STOP', 'invalid unused duration')['enabled'])
        opened = switch.make_record('OPEN')
        self.assertTrue(opened['enabled'])
        self.assertIsNone(opened['closesAt'])

    def test_chosen_duration_and_unique_sessions(self):
        now = dt.datetime(2026, 11, 11, 10, tzinfo=dt.timezone.utc)
        a = switch.make_record('OPEN', '30', now)
        b = switch.make_record('OPEN', '30', now)
        self.assertEqual(a['closesAt'], '2026-11-11T10:30:00+00:00')
        self.assertNotEqual(a['sessionId'], b['sessionId'])

    def test_invalid_inputs_are_rejected(self):
        for action, minutes in [('stop', '0'), ('OPEN', '-1'), ('OPEN', '241'),
                                ('OPEN', 'nan'), ('OPEN', '1;echo unsafe')]:
            with self.assertRaises(ValueError):
                switch.make_record(action, minutes)

    def test_local_invocation_cannot_publish(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}, clear=True):
            with self.assertRaises(RuntimeError):
                switch.main()

    def test_rename_follows_same_repository_but_not_other_repositories(self):
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY_ID': '1450788815',
               'GITHUB_REPOSITORY_OWNER': 'FelixSitu20', 'GITHUB_ACTOR': 'FelixSitu20',
               'GITHUB_TRIGGERING_ACTOR': 'FelixSitu20', 'GITHUB_REPOSITORY': 'FelixSitu20/Renamed-Play'}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(switch.runtime_repository(), 'FelixSitu20/Renamed-Play')
            for key, value in [('GITHUB_REPOSITORY_ID', '123'), ('GITHUB_REPOSITORY_OWNER', 'Other'),
                               ('GITHUB_ACTOR', 'Other'), ('GITHUB_TRIGGERING_ACTOR', 'Other'),
                               ('GITHUB_REPOSITORY', 'Other/Renamed-Play')]:
                with patch.dict(os.environ, {key: value}):
                    with self.assertRaises(RuntimeError):
                        switch.runtime_repository()

    def test_control_branch_is_only_change(self):
        with tempfile.TemporaryDirectory(prefix='summ-switch-local-test-') as name:
            root = Path(name).resolve()
            self.assertEqual(root.parent, Path(tempfile.gettempdir()).resolve())
            remote = root / 'remote.git'
            work = root / 'work'
            remote.mkdir(); work.mkdir()
            git(remote, 'init', '--bare', '--quiet')
            git(work, 'init', '--quiet', '-b', 'main')
            git(work, 'config', 'user.name', 'Local test')
            git(work, 'config', 'user.email', 'test@example.invalid')
            git(work, 'remote', 'add', 'origin', str(remote))
            (work / 'index.html').write_text('unchanged game', encoding='utf-8')
            git(work, 'add', 'index.html')
            git(work, 'commit', '--quiet', '-m', 'Original local test build')
            git(work, 'push', '--quiet', 'origin', 'main')
            original = git(work, 'rev-parse', 'HEAD')
            last = None
            for action in ('STOP', 'OPEN', 'STOP'):
                state = switch.make_record(action)
                commit = switch.publish(work, state)
                self.assertEqual(git(remote, 'rev-parse', switch.CONTROL_REF), commit)
                self.assertEqual(json.loads(git(remote, 'show', commit + ':session.json')), state)
                self.assertEqual(git(remote, 'ls-tree', '--name-only', commit), 'session.json')
                if last:
                    self.assertEqual(git(remote, 'rev-parse', commit + '^'), last)
                last = commit
                self.assertEqual(git(work, 'rev-parse', 'HEAD'), original)
                self.assertEqual(git(remote, 'rev-parse', 'refs/heads/main'), original)
                self.assertEqual((work / 'index.html').read_text(), 'unchanged game')
                self.assertEqual(git(work, 'status', '--porcelain'), '')


if __name__ == '__main__':
    unittest.main(verbosity=2)