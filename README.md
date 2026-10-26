# AI Content Review Bot

A standalone Discord bot for reviewing pasted Reddit posts and comments with an AI detector. It has its own application, credentials, deployment, and repository; SeaBot is not required.

`/ai-check` returns a **private report** with AI-generated, AI-assisted, and human text percentages; a segment chart; paginated excerpts; and a complete text attachment. The requester can explicitly post the same report to the original channel without another paid scan.

Access is allowed in the configured `#subreddit-chat` channel and its direct child threads **or** for members with the configured **Subreddit Mod** role. DMs and other servers are rejected. Channel and role IDs, not names, determine access.

Pangram is the first backend. Its API behavior is isolated behind a small provider interface so another detector can be added without changing the Discord workflow. Percentages are shares of classified text, not probabilities that someone used AI. Reports support human review and never take moderation actions.

## Status

Scanning defaults to **disabled**. Development and tests use synthetic responses and block application-service connections. Real Discord/Pangram acceptance, application creation, credentials, and activation are a later step.

The approved initial release shows **estimated scan costs** and explicitly marks remaining API credits **unavailable**. Actual balance retrieval requires a verified provider contract. The configured $0.05 per 100-word block is an estimate to verify before enabling.

## Build and test offline

Use Node **24.22.1** (see `.node-version`) and npm. Only discord.js and canvas are runtime dependencies. Dependencies and GitHub Actions are locked; the Docker image includes the native libraries and fonts canvas needs.

```sh
npm ci
npm run check
npm run audit:production
npm run commands
```

`npm run commands` prints the command definition without credentials or network calls. It does not register anything. Tests preload a network blocker and use injected provider/Discord transports, including the real SDK's serialization and cache behavior. Importing runtime modules never starts the bot.

To validate the production image without starting the bot:

```sh
docker build -t ai-content-review-bot:test .
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=32m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true --entrypoint node \
  -v "$PWD/tests/container-smoke.cjs:/app/container-smoke.cjs:ro" \
  ai-content-review-bot:test /app/container-smoke.cjs
```

The Docker commands above use POSIX shell syntax. Builds can download packages; tests and runtime smoke checks do not connect to Discord or Pangram. CI runs the same checks, audits production dependencies, and validates the final non-root image with networking disabled.

## Configure and deploy later

Follow [deployment and live acceptance](docs/deployment.md). In brief:

1. Create a dedicated Discord application/bot and install it in the intended server.
2. Copy `.env.example` to an untracked `.env` and fill in the application, guild, channel, role, and token values. Keep scanning disabled until live acceptance passes.
3. Register the guild command explicitly with `npm run commands -- --apply`.
4. Deploy exactly one instance with Docker Compose or the published container image.

`npm start` connects to Discord. `npm run commands -- --apply` writes to Discord. Neither belongs in offline tests or CI. The runtime never automatically registers or deletes commands.

## Command behavior and limits

- `/ai-check` opens a 4,000-character text modal that names the receiving provider. Longer text can use `file:` with a UTF-8 `.txt` attachment.
- Pangram accepts 50–5,000 words here, within 256 KiB. Input is rejected rather than silently truncated or split into paid scans.
- Current permissions and private-thread membership are rechecked. Only the requester can navigate or share a report, in the original channel.
- One scan per user, two simultaneous scans per process, and a 60-second submission cooldown. Invalid input does not consume a submission. These are not account-wide spending limits.
- Failed report delivery can be recovered by running `/ai-check` without a file in the original channel before expiry. Recovery does not submit another scan.
- Report controls expire within ten minutes after completion, before the Discord interaction token expires. Restarts lose in-memory reports. Up to 100 sessions are retained; older inactive sessions may be evicted.
- A provider submission is never automatically retried. If its outcome is uncertain, a charge may still occur. Public sharing uses a lock and nonce; uncertain posting disables further attempts to avoid duplicates.

See [architecture, privacy, and provider contracts](docs/architecture.md) for the implementation boundaries and current limitations.

## Releases

Every push to `main` and every pull request runs CI. A `v*` tag or manual **Publish container** workflow verifies the revision and publishes to `ghcr.io/sayhiben/ai-content-review-bot`, including a `sha-<full-commit>` tag. Publishing an image does not deploy or activate the bot. Deploy a verified digest and retain the previous digest for rollback.

The initial release is extracted from the AI-detection work proposed in [SeaBot PR #274](https://github.com/reddit-seattle/seabot/pull/274). Relevant code is preserved under the MIT license, with the original notice retained in [LICENSE](LICENSE).
