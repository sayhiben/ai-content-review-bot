# Deployment

Run one long-lived worker with persistent storage and outbound access to Discord and the enabled providers. The bot requires no inbound port. Use a host that supports continuous Gateway connections.

## Discord application

1. Create a Discord application and bot. Leave **Interactions Endpoint URL** empty; interactions arrive over the Gateway.
2. Enable **Guild Install** with `bot` and `applications.commands` scopes. No privileged Gateway intents are required.
3. Grant View Channel, Send Messages, Send Messages in Threads, Embed Links, and Attach Files where reports may be posted. Invite the bot to private threads it should serve.
4. Configure the guild, allowed channel, allowed role, and thread policy using Discord IDs. Members also need Use Application Commands permission. Avoid role-only command restrictions that override the channel-or-role rule.

## Configuration

Copy `.env.example` to `.env`, or inject variables from a secret manager. Restart to apply changes. Tokens must not enter source control, build arguments, or container images.

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_APPLICATION_ID` | Application ID, needed for command registration |
| `DISCORD_GUILD_ID` | Server the bot serves |
| `ALLOWED_CHANNEL_ID` | Channel permitting use without the configured role |
| `ALLOWED_ROLE_ID` | Role permitting use in other accessible channels |
| `ALLOW_CHANNEL_THREADS` | Whether direct child threads inherit channel access; default `true` |
| `AI_DETECTION_ENABLED` | Master switch for scanning; default `false` |
| `CACHE_PATH` | SQLite file; default `data/reports.sqlite` |
| `PANGRAM_ENABLED` | Offer Pangram when a key is present; default `true` |
| `PANGRAM_API_KEY` | Pangram API key |
| `PANGRAM_MODEL` | API model selector; default `pangram-4` |
| `PANGRAM_MODEL_VERSION` | Required explicit cache version for the selected Pangram model |
| `PANGRAM_USD_PER_100_WORDS` | Estimated USD rate per rounded-up 100-word block; default `0.05` |
| `GPTZERO_ENABLED` | Offer GPTZero when a key is present; default `false` |
| `GPTZERO_API_KEY` | GPTZero API key |
| `GPTZERO_MODEL_VERSION` | Required API model version, also used for caching |
| `GPTZERO_USD_PER_1000_WORDS` | Optional estimated USD rate per 1,000 words |

An available provider is enabled and has a configured key. With both available, the user selects one. Scanning cannot be enabled with no available providers. Every available provider requires an explicit version; blank, `latest`, and `default` versions are rejected. Configure rates from your account's pricing. Changing providers does not require command registration.

GPTZero receives `GPTZERO_MODEL_VERSION` in its API request. Pangram receives `PANGRAM_MODEL`; `PANGRAM_MODEL_VERSION` identifies the cache generation and is not an API version pin. Set it to the model release you have verified, and change it when that selector's behavior changes. The bot cannot discover a silent upstream model replacement while serving a cached result.

## Register and start

```sh
npm ci
npm run build
npm run commands
npm run commands -- --apply
docker compose build
docker compose up -d --no-build
docker compose ps
```

Preview is offline. `--apply` creates or updates `/ai-check` in the configured guild. Registration runs separately from bot startup and needs only the Discord token, application ID, and guild ID.

Compose runs the bot as a non-root user with a read-only root filesystem, writable temporary memory, and a named `reports` volume at `/app/data`. Keep `CACHE_PATH` inside that mount. When deploying without Compose, create a persistent directory writable by the container user (UID 1000) and restrict its permissions.

For a published image, set `BOT_IMAGE=ghcr.io/sayhiben/ai-content-review-bot@sha256:<digest>`, authenticate to GHCR if needed, and run:

```sh
docker compose pull bot
docker compose stop bot
docker compose up -d --no-build
```

Stop the old instance before starting another. Do not scale above one replica or overlap releases. Shutdown drains work before closing the database and Discord client. Interaction controls expire on restart; saved analyses remain available when the text is submitted again.

## Cache operations

The SQLite database contains report text and metadata, without credentials or requester identities. Retention is indefinite so repeat text can continue to reuse results. Monitor volume capacity. Stop the bot before copying the database for backup or modifying it, and keep backups access-restricted.

Successful reports and unconfirmed scans occupy the same table. A record without a result means submission may have occurred, but no result was saved. Investigate the corresponding scan in the provider account before deciding whether another paid attempt is acceptable. A database administrator can inspect and remove a specific unresolved entry:

```sql
SELECT key, scanned_at FROM analyses WHERE result IS NULL;
DELETE FROM analyses WHERE key = '<verified hash>' AND result IS NULL;
```

The timestamp is Unix milliseconds. Removing a record or the database permits a new paid scan for that content. Restore the database when restoring the deployment; `docker compose down -v` removes the saved reports. Cache read/write failures stop the affected request instead of silently submitting again.

## Verification and monitoring

- Require passing CI for the deployed commit, including the 100% coverage gate and offline container smoke test.
- Validate each enabled account's model, response semantics, pricing, retention, and spending controls in a development server. Test with suitable sample text and save sanitized provider fixtures.
- Check private responses, provider selection, channel-or-role access, private threads, segments, sharing, and delivery recovery on desktop and mobile.
- Repeat identical text and restart the worker; both should replay the saved result without a new provider submission. Change the configured version to verify that a new scan becomes eligible.
- Check the budget against the account. Cached balances are historical snapshots. Pangram balance is unavailable; GPTZero balance lookups can also be unavailable.

The health check reads a local heartbeat requiring Gateway readiness and an available configured guild. It makes no provider request. Monitor unhealthy status separately: Compose restarts exited processes, not merely unhealthy ones. Logs contain operational outcomes, not submitted text or credentials.

To smoke-test an image offline (POSIX shell):

```sh
docker build -t ai-review-test .
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,size=32m,mode=1777 \
  --tmpfs /app/data:rw,size=16m,uid=1000,gid=1000,mode=700 \
  --cap-drop ALL --security-opt no-new-privileges:true --entrypoint node \
  -v "$PWD/tests/container-smoke.cjs:/app/container-smoke.cjs:ro" \
  ai-review-test /app/container-smoke.cjs
```

## Rollback

Set `AI_DETECTION_ENABLED=false`, stop the worker, and restore the verified image, matching configuration, and database backup. Check the disabled response before enabling scans. Stopping the bot cannot refund provider work or remove public Discord posts. To retire it, stop the worker and remove its application from the server.
