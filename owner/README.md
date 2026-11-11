# Summuition online play switch

Local prototype. Not yet enabled or tested against the live GitHub state.

## Owner access after activation

Bookmark the [Summuition play switch](https://github.com/FelixSitu20/Summuition-Play/actions/workflows/play-switch.yml) while signed in as FelixSitu20.

1. Select **Run workflow** on branch **main**.
2. Leave **STOP** selected, then select **Run workflow** to pause normal entry.
3. Wait for the run result. Its summary distinguishes a committed change from one observed at the public status endpoint.
4. To resume, run it with **OPEN**. Leave minutes at **0** for no automatic end, or choose 1-240 minutes yourself. Each OPEN starts a new session; an old tab must reload to join it.

The GitHub workflow is pinned to repository ID 1450788815 and checks both the original actor and rerun actor are FelixSitu20. A repository rename does not expand its scope. The public status URL follows the project path of session-control.js, and the owner helper uses the current authenticated repository name supplied by GitHub. No token, password or admin secret is sent to players. Repository administrators can still edit the workflow and files, as with any repository automation.

## What the switch does

- A new game page must read OPEN before it downloads the Unity player.
- Running pages check every three seconds. When they receive STOP or see a newer session, they navigate away, destroying the Unity document rather than just covering the canvas.
- A missing or malformed state blocks new entry. An already-running game continues through a connection failure while checks retry; it stops only when it receives STOP or a newer session, or reaches an optional owner-selected end time. A suspended tab checks again when it resumes. A disconnected running game cannot receive STOP until it reconnects.
- No automatic duration is imposed. The optional duration is applied only if the owner chooses one when opening.

## Limits

This is a cooperative supervised-play control, not authentication or protected hosting. GitHub Actions can queue. Raw GitHub advertises a five-minute cache lifetime; unique query strings and no-store requests improve freshness but are not a propagation guarantee. Three seconds is the polling interval, not a guaranteed end-to-end shutdown time.

Old cached wrappers from before this feature do not check the switch. GitHub Pages also advertises a ten-minute cache lifetime. Direct compiled asset URLs remain public, and downloaded, offline or modified copies cannot be revoked. School filtering of raw.githubusercontent.com can prevent this gate from opening even if Pages itself loads. Verify the school network before relying on it.

For a host-level fallback, GitHub's [Unpublish site](https://github.com/FelixSitu20/Summuition-Play/settings/pages) control removes the current Pages deployment. It also has propagation limits and cannot stop an already-loaded game. Do not delete the repository or change its visibility as an emergency shortcut.

## Activation checklist

Publishing and live-state changes are deliberately separate from this local prototype.

1. Review the `contents: write` permission on the switch workflow. GitHub provides a temporary token for each run; it can write repository contents, although this helper only updates `session-control`. No custom credential or paid service is needed. Do not change account-wide Actions settings or add a PAT as a workaround if the job is denied.
2. Publish the workflow and helper to main first, without publishing the gated guest wrapper yet. Run OPEN with the owner's selected duration (0 means none) and verify its raw state. Otherwise new entry will be blocked when the gate first ships.
3. Publish the audited guest wrapper and its two supporting files; keep compiled build hashes unchanged. Verify the exact deployment commit and every live payload hash.
4. With authorization to interrupt the live test, check STOP blocks a fresh private-browser entry and OPEN restores it. Also check a running tab. Distinguish observed propagation time from a general guarantee.
5. Verify the final workflow link is available to the owner on their phone. Give them the bookmark and the concise STOP steps.

The workflow pushes only a JSON object to the separate `session-control` branch. It does not trigger a Pages rebuild, force-push, change main, include Unity source, or collect player data.

## Local checks

Run from this repository with existing Python 3.10+ and Node installations:

- `python tests/owner-control.test.py`: disposable local Git remote only; verifies STOP/OPEN/STOP preserve main and the working tree.
- `node tests/session-control.test.cjs`: state, timing, outage, expiry and race tests without network calls.
- `node tests/display.test.cjs`: existing display and immutable compiled-build checks.
- `python tests/verify-publication.py`: exact payload allowlist, sizes, hashes and safe entry routing.
- `node tests/session-browser.test.cjs`: optional isolated headless Edge integration. Set `SUMM_PLAYWRIGHT` to an installed Playwright module if not resolvable, and `SUMM_EDGE` if Edge is in a different path. All status responses are mocked, so this is not a live propagation test.

Local Edge validation passed: CLOSED made zero Unity asset requests; OPEN loaded the real compiled game; STOP unloaded it; a newer session ended the old tab; offline status and missing gate script blocked new entry, while a brief outage did not end active play. No browser runtime errors were observed. Audible audio, school Chromebook behavior, old-cache migration, live runner permissions and live propagation remain unverified.