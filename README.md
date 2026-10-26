# AI Content Review Bot

A standalone Discord bot for reviewing pasted posts, comments, and other text with an AI detector. It has its own application, credentials, deployment, and repository.

`/ai-check` returns a **private report** with the chosen detector's results, a segment chart when positions are verified, paginated excerpts, and a complete text attachment. The requester can explicitly post the same report to the original channel without another paid scan.

Access is allowed in `ALLOWED_CHANNEL_ID` **or** for members with `ALLOWED_ROLE_ID`, within `DISCORD_GUILD_ID`. `ALLOW_CHANNEL_THREADS` controls whether the channel's direct child threads also qualify (default `true`). DMs and other servers are rejected. Access messages use the configured IDs; community names are never hardcoded.

Pangram and GPTZero are independently configurable backends behind the same provider interface. With one enabled backend and a configured key, selection is automatic. With both available, the input modal asks which provider to use, including for file attachments. Only the selected provider receives the text; errors never trigger a scan with another provider.

Pangram reports fractions of classified text. GPTZero reports document-class probabilities and sentence highlights; those probabilities are explicitly distinguished from percentages of text. Reports support human review and never take moderation actions.

## Status

Scanning defaults to **disabled**. Development and tests use synthetic responses and block application-service connections. Real Discord/provider acceptance, application creation, credentials, and activation are a later step.

Scan costs are estimates. Pangram's remaining credits remain **unavailable** under the approved initial scope; its configured $0.05 per 100-word block must be verified before enabling. GPTZero retrieves a remaining-word snapshot after successful scans; failed or null quota lookups stay unavailable. GPTZero's optional cost estimate uses your configured per-1,000-word rate, with no assumed price.

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

The Docker commands above use POSIX shell syntax. Builds can download packages; tests and runtime smoke checks do not connect to Discord or either detector. CI runs the same checks, audits production dependencies, and validates the final non-root image with networking disabled.

## Configure and deploy later

Follow [deployment and live acceptance](docs/deployment.md). In brief:

1. Create a dedicated Discord application/bot and install it in the intended server.
2. Copy `.env.example` to an untracked `.env` and fill in the application, guild, channel, role, and token values. Keep scanning disabled until live acceptance passes.
3. Register the guild command explicitly with `npm run commands -- --apply`.
4. Deploy exactly one instance with Docker Compose or the published container image.

Community-specific mappings belong in configuration; [the optional Seattle example](examples/seattle.env.example) demonstrates one. The deployment guide includes the [environment migration](docs/deployment.md#environment) from the original variable names.

`npm start` connects to Discord. `npm run commands -- --apply` writes to Discord. Neither belongs in offline tests or CI. The runtime never automatically registers or deletes commands.

## Command behavior and limits

- `/ai-check` opens a 4,000-character text modal that names the receiving provider. Longer text can use `file:` with a UTF-8 `.txt` attachment.
- When both providers are available, choose one in the modal before submitting. For attachments, the modal contains only the provider choice; no file is downloaded or scanned until submission.
- Both adapters use a 50–5,000-word bot policy, within 256 KiB; GPTZero additionally caps input at 150,000 UTF-16 code units. Input is rejected rather than silently truncated or split into paid scans.
- Current permissions and private-thread membership are rechecked. Only the requester can navigate or share a report, in the original channel.
- One scan per user, two simultaneous scans per process, and a 60-second submission cooldown, shared across providers. Invalid input does not consume a submission. These are not account-wide spending limits.
- Failed report delivery can be recovered by running `/ai-check` without a file in the original channel before expiry. Recovery does not submit another scan.
- Report controls expire within ten minutes after completion, before the Discord interaction token expires. Restarts lose in-memory reports. Up to 100 sessions are retained; older inactive sessions may be evicted.
- A provider submission is never automatically retried. If its outcome is uncertain, a charge may still occur. Public sharing uses a lock and nonce; uncertain posting disables further attempts to avoid duplicates.

See [architecture, privacy, and provider contracts](docs/architecture.md) and the [Discord best-practices review](docs/discord-review.md) for implementation decisions and current limitations.

## Releases

Every push to `main` and every pull request runs CI. A `v*` tag or manual **Publish container** workflow runs the same verification and publishes the exact image that passed its smoke test to `ghcr.io/sayhiben/ai-content-review-bot`, including a `sha-<full-commit>` tag. Publishing an image does not deploy or activate the bot. Deploy a verified digest and retain the previous digest for rollback.

The initial release is extracted from the AI-detection work proposed in [SeaBot PR #274](https://github.com/reddit-seattle/seabot/pull/274). Relevant code is preserved under the MIT license, with the original notice retained in [LICENSE](LICENSE).
