# Anonymous chat release

The experience supports public topic rooms and random one-to-one text conversations, with a visible choice between temporary guests and registered accounts.

## Privacy contract

- Guest history is not stored for the guest session. Messages received by account participants are saved to that account for 30 days, including messages sent by guests.
- Account history is private to the account holder, limited to the most recent 500 messages in the interface, and can be cleared or exported.
- Saving history is an explicit browser-device preference. Turning it off removes saved anonymous history from that browser.
- Other participants can copy messages or save their own history. Disappearing history is not a guarantee that every copy disappears.
- Reports retain the selected message for up to seven days for moderation. Infrastructure access logs may contain IP addresses.
- No end-to-end encryption or anonymity from the hosting operator is claimed.

## Release requirements

- Test room isolation, matchmaking, disconnects, reconnection, server-issued identities, bans, reporting and socket spam limits.
- Check desktop and mobile chat layouts and keyboard navigation.
- Confirm the intended audience, publish community rules and a privacy policy, and assign moderators before inviting the public.
- Define report retention and moderator response targets before public launch.
- Establish availability monitoring, error alerts, database backups and a tested restore process.
- Run a realistic concurrency test before advertising capacity. The initial deployment is a single Node process; matchmaking state is in memory.
- Rotate secrets that have been committed to Git. `server/.env` is now ignored and untracked, but earlier commits still contain it. Ignore rules do not remove secrets from history.
- Dependency folders and build outputs are ignored and untracked. Use reproducible installs and supported Node versions in CI.
- Guest blocking is a session/device deterrent, not protection against a determined person changing browser or network.

## Operations

Use WSL and the `ubuntu` SSH login described in `.agents/AGENTS.md`. Stage changes, run isolated tests, back up the deployed files, and verify health before and after restarting `chat-backend`.

`/api/health` checks database availability. Anonymous rooms, presence and matching currently use process memory. A restart ends active conversations; guests can reconnect to rooms and account history remains available.

`redeploy.sh` now refuses a dirty tracked worktree rather than discarding local changes. Commit and push the release sources before using the normal Git-based deployment workflow.

The release has isolated backend regression tests in `server/auth.test.js` and `server/anonymous.test.js`. They require client and server dependencies. Windows Node 24 cannot use the currently pinned SQLite native binary without C++ build tools; the release was tested with clean installs on the Linux server. Development-tool advisories remain and should be addressed with a reviewed Vite/Tailwind upgrade.
