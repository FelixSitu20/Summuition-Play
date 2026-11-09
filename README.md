# Summuition

Public device-test build of the standalone Summuition arithmetic game.
School Chromebook compatibility testing is **pending**.

This repository contains only the audited web player and deployment files,
not the full game or its Unity project. Local desktop loading, basic controls,
resizing and reload passed smoke tests. Full device/gameplay/audio verification
is not claimed. Online leaderboard service is not configured.

The public manifest records the build hashes and pending checks honestly.
The original fully-verified-release packaging workflow remains separate.

## Updating

Build and audit a new standalone player, verify its exact files and record
actual device checks. Replace only the output in `site/`, review the changes,
and publish an authorized update. Never add source, private audits, logs, saves
or credentials.
