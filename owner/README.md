# Summuition online play switch

[Open the owner STOP / OPEN controls](https://github.com/FelixSitu20/Summuition-Play/actions/workflows/play-switch.yml) while signed in to GitHub as FelixSitu20. Bookmark this page for supervision.

## Stop play

1. Select **Run workflow** on branch **main**.
2. Leave **STOP** selected and select **Run workflow**.
3. Check the run result. Its summary distinguishes a committed change from one observed at the public status endpoint.

GitHub queues and caching mean this is not instant. The real control test took about two minutes for STOP to reach the test browser. Other devices can take longer. A green workflow confirms the new signal was observed from its runner, not that every browser has received it.

To resume, run the same workflow with **OPEN**. Leave minutes at **0** for no automatic end, or choose 1-240 minutes yourself. Each OPEN starts a new session; old tabs must reload to join it. Invalid optional duration text cannot block STOP.

## What it controls

- A new game page must read OPEN before downloading the Unity player.
- Running pages check every three seconds. When they receive STOP or a newer session, they navigate away, destroying the Unity document rather than just covering its canvas.
- A missing or malformed signal blocks new entry. An already-running game continues through connection failures while checks retry. It cannot receive STOP while disconnected.
- An automatic end applies only if the owner chooses a duration.

This is a cooperative supervised-play control, not authentication or protected hosting. Old cached pages from before the gate, direct compiled asset URLs, and downloaded or modified copies are outside it. Raw GitHub advertises a five-minute cache lifetime, and Pages a ten-minute lifetime. Cache-busting is not a propagation guarantee. School filtering of raw.githubusercontent.com may block entry even when Pages itself loads; verify the school network before relying on it.

GitHub also provides [Unpublish site in Pages settings](https://github.com/FelixSitu20/Summuition-Play/settings/pages) as a host-level fallback. It has propagation limits and cannot revoke already-loaded or downloaded games. Do not delete the repository or change its visibility as an emergency shortcut.

## Owner and source safeguards

The workflow is pinned to immutable repository ID 1450788815 and checks both the original and rerun actor are FelixSitu20. A rename does not expand its scope. GitHub supplies a temporary job token with repository-content write permission; the helper only updates the separate session-control branch, never force-pushes, and leaves main and the working tree unchanged. No custom token, browser secret or player data is stored. Repository administrators can still edit automation, as with any repository.

The public signal URL follows the project path of session-control.js. The owner helper uses the current repository name supplied by GitHub. The deployed folder contains compiled game files and the gate, not Unity source or owner scripts.

## Updating and checks

Preserve the gate hook, session-control.js and session-ended.html when replacing the audited compiled build. Keep its four asset references and the exact publication manifest/hash checks current. Never ship a bypass for local testing.

Run from this repository with Python 3.10+ and Node:

- python tests/owner-control.test.py: six tests using a disposable local Git remote, including identity/rename restrictions and STOP/OPEN/STOP preservation of main.
- node tests/session-control.test.cjs: gate state, expiry, outage and race tests without network calls.
- node tests/display.test.cjs: existing display, softer palette and compiled-build checks.
- python tests/verify-publication.py: exact public file allowlist, sizes, hashes and safe routes.
- node tests/session-browser.test.cjs: isolated headless Edge integration with mocked status responses. Set SUMM_PLAYWRIGHT to an installed Playwright module if needed, and SUMM_EDGE if Edge is elsewhere.

Real GitHub control tests are performed against an isolated candidate before connecting it to the public site, to avoid interrupting existing players. Device compatibility and audible audio still need their own checks.