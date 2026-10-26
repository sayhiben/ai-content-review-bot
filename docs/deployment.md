# Deployment and live acceptance

The bot is a single long-running Gateway worker. It needs outbound HTTPS/WebSocket access to Discord and HTTPS access to Pangram after activation. It has no inbound port, database, shared volume, source-platform credentials, or web server. The repository alone does not create a Discord application or authorize paid scans.

## Dedicated Discord application

During the later authorized live-integration step:

1. Create a dedicated application in the Discord Developer Portal and add its bot. Leave **Interactions Endpoint URL empty**: this app receives interactions over the Gateway, not HTTP webhooks.
2. Use **Guild Install** with `bot` and `applications.commands` scopes. Enable only the normal **Guilds** Gateway intent in code. Message Content, Guild Members, and Presence privileged intents are not needed.
3. Grant View Channel, Send Messages, Send Messages in Threads, Embed Links, and Attach Files where reports may be posted. Do not grant Administrator. Invite the bot to private threads it should serve; it cannot access threads hidden from it.
4. Configure the guild, allowed channel, allowed role, and thread policy using IDs from your community. The optional [community example](../examples/seattle.env.example) maps a specific server's policy onto these settings; it is not loaded automatically.
5. Avoid role-only command permissions in Discord that would override the intended channel-OR-role access rule. Members also need Discord's Use Application Commands permission.

## Environment

Copy `.env.example` to `.env` locally, or inject the same variables from the host's secret manager. Never commit tokens or include `.env` in image builds.

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Dedicated bot token; needed to start or apply command registration |
| `DISCORD_APPLICATION_ID` | New application's ID; needed only for registration |
| `DISCORD_GUILD_ID` | The single server this bot serves |
| `ALLOWED_CHANNEL_ID` | Channel that permits use without the configured role |
| `ALLOWED_ROLE_ID` | Role that permits use in other visible channels in the same server |
| `ALLOW_CHANNEL_THREADS` | `true` by default; direct child threads inherit channel access. `false` disables that inheritance, but the role still permits use in accessible threads |
| `AI_DETECTION_ENABLED` | `false` by default; only literal `true` enables scans |
| `AI_DETECTION_PROVIDER` | `pangram` initially |
| `PANGRAM_API_KEY` | Required only when scans are enabled |
| `PANGRAM_MODEL` | Defaults to `pangram-4`; verify account access before enabling |
| `PANGRAM_USD_PER_100_WORDS` | Positive estimated rate; defaults to `0.05`, not a verified price quote |

Startup validates configuration without echoing values. Configuration is read once; restart to apply changes. The bot can connect with scanning disabled and no Pangram key. Channel and role IDs are still required. Registration needs only the token, application ID, and guild ID.

**Migration:** rename `SUBREDDIT_CHANNEL_ID` to `ALLOWED_CHANNEL_ID` and `SUBREDDIT_MOD_ROLE_ID` to `ALLOWED_ROLE_ID`, preserving their values. Set `ALLOW_CHANNEL_THREADS=true` to preserve the original thread behavior. Old names are not aliases: missing new names fail startup. Keep a copy of the old environment alongside the old image digest for rollback. Refresh the command definition during the later live step to pick up its generic description; this development change does not contact Discord.

## Command registration

Build first with `npm ci && npm run build`. Preview with `npm run commands`. Once live writes are authorized, run:

```sh
npm run commands -- --apply
```

This creates or updates **only `/ai-check` in the configured guild**, using Discord's single-command POST endpoint. Other commands and global commands remain intact. Use the dedicated application's token. Repeat registration only when command definitions change. Normal process startup never registers commands.

From a container, after pulling/building its image:

```sh
docker compose run --rm --no-deps bot node dist/registerCommands.js --apply
```

## Container deployment

Docker Compose is the reference deployment. The image runs as a non-root user; Compose sets a read-only root filesystem, writable temporary memory, dropped Linux capabilities, bounded logs, and a 330-second stop grace period. No persistent storage is needed.

Local build, during authorized deployment:

```sh
docker compose build
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=50 bot
```

For a published image, authenticate Docker to GHCR if the package is private. Resolve the release tag to a digest and set `BOT_IMAGE=ghcr.io/sayhiben/ai-content-review-bot@sha256:<digest>` in the deployment environment. Pull before stopping the current instance:

```sh
docker compose pull bot
docker compose stop bot
docker compose up -d --no-build
```

Do not run the Node process and the container together. Do not scale this worker above one replica, use overlapping rolling releases, or start the new instance before the old one stops. In-memory concurrency, cooldown, and publish locks are process-local.

The health check reads a local heartbeat: the Gateway must be ready, the configured guild must be present and available, and the heartbeat must be less than 60 seconds old. It uses no network request, port, or provider credit. Health becomes false during draining. This is process/Gateway health, not a provider or full permissions probe. A Docker unhealthy status needs host monitoring; Compose's restart policy restarts exited processes, not merely unhealthy ones.

SIGTERM/SIGINT stops accepting requests, allows existing work up to 315 seconds to finish, then disposes state, aborts outstanding provider requests, and closes the client. The provider may continue or bill already submitted tasks. Reports and controls do not survive process restarts; no work is automatically resubmitted.

Use an always-on container/worker host supporting outbound Gateway connections. A web-request-only or scale-to-zero hosting plan is unsuitable. The checked CI image is Linux amd64; validate other architectures before deployment.

## Acceptance before enabling

1. Require green CI on the exact candidate: strict TypeScript, offline tests, dependency audit, production image build, and a network-disabled final-image smoke test. The publish workflow runs the same shared verification action and tags/pushes that tested local image without rebuilding it.
2. Confirm the account's async API/model, response schema, offset convention, pricing, retention, and available spending controls. Save sanitized fixtures for short uncertain, human, assisted, and mixed results. Existing synthetic fixtures do not establish the vendor contract.
3. Install/register in a development server with scans disabled. Verify authorized and unauthorized users get private responses and no provider submission occurs.
4. With explicit approval and sample text, enable scans in development. Verify modal/file input, channel-OR-role access, both thread-policy settings, private-thread revocation, desktop/mobile display, paginated segments, full attachments, delivery recovery, expiry, and owner-only public sharing. Check actual billing impact. Balance remains explicitly unavailable under the approved estimates-only scope.
5. Exercise rollback, confirm a single active instance, and then approve production activation. Set provider-side spending limits where available; bot limits are not a shared account budget cap.

## Rollback

Set `AI_DETECTION_ENABLED=false`, stop the existing worker, and restart it with the updated environment. Verify `/ai-check` reports disabled without submitting work. For a code regression, restore the previous verified image digest while keeping scans disabled until the issue is understood. Keep the preceding deployment's image and configuration available.

Stopping or disabling cannot cancel/refund work already accepted by Pangram or revoke public Discord posts. Do not retry an uncertain scan just to test recovery. Delivered Discord messages/attachments have their own retention independent of the bot's session lifetime.

To retire the bot completely, stop the worker and remove its dedicated application from the server in a separately authorized live step.
