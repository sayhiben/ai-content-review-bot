# Architecture and provider boundaries

```text
main.ts -> validated environment -> bot.ts (Discord lifecycle)
                                -> createAiCheckFeature (one private error boundary)
                                     -> AiCheckInteractions (Discord UI and access)
                                     -> AiCheckService (submission gates and report state)
                                          -> AiDetectionProvider
                                               -> PangramProvider (HTTP and normalization)

DetectionResult -> report.ts (embed, segment pages, PNG, complete text)
registerCommands.ts -> command.ts (explicit registration; offline preview by default)
health.ts -> local heartbeat only
```

Runtime modules have no import-time login or command-registration side effects. The standalone bot uses stable discord.js, strict TypeScript, and Node's built-in test runner. There is no SeaBot router, server import, shared configuration, webpack bundle, plugin registry, queue, database, failover, or multi-provider scoring framework.

Configuration has separate Discord `access` and `detection` sections. The feature receives only those sections; the lifecycle owns the Discord login token. A small pure policy in `discord/access.ts` implements the single-guild channel-OR-role rule and optional thread inheritance. The same policy serves initial and current authorization checks. User-facing access hints reference configured IDs, so renaming a channel or role does not require a code change. Only the optional community environment example contains community-specific policy labels.

`AiDetectionProvider` exposes its name, minimum word count, and one cancellable analysis operation. The normalized `DetectionResult` contains optional text fractions, labeled segments with optional verified positions, usage, and optional observed balance. Missing data stays unavailable. To add a backend, implement that interface and add a configuration/composition branch with fixtures. Do not translate a confidence score into a fraction of AI-written text.

## Pangram adapter

The current contract assumption is one `POST /task` with the configured model and `public_dashboard_link: false`, followed by `GET /task/{id}` polling. Requests time out after ten seconds within a five-minute scan deadline. Polls retry transient failures with bounded backoff and honor `Retry-After`; paid POST submission never retries automatically. Responses are capped at 4 MiB and analyzed text at 256 KiB.

API contract, model access, and pricing still require live acceptance. Synthetic fixtures exercise the expected schema without claiming the provider has verified it. Until its offset convention is established, code-point and UTF-16 positions are checked against returned segment text. If both match different occurrences of repeated text, positions are omitted. The chart is omitted when positions cannot be verified; complete labels and text remain available. Overlaps and gaps are preserved rather than inferred to be human or forced into aggregate percentages.

Costs are estimated as rounded-up 100-word blocks at the configured rate. The bot's Unicode word count may differ from billing. The approved initial release has no remaining-credit endpoint. It displays unavailable balance and links to API account information. A future verified balance can use the existing amount, unit, and observation timestamp fields; local scan counts must not fabricate an account balance.

## Report state and privacy

Submission gates and report sessions are bounded and in memory. Modal/file paths share one scan service. Invalid input does not start the paid submission cooldown. At most two scans run at once, one per user, with 60 seconds between submissions. At most 100 sessions are kept, and older inactive ones can be evicted.

Controls are bound to requester, guild, channel, and message. Authorization fetches current member/channel state; private-thread membership bypasses the SDK cache. Reports are ephemeral until the requester explicitly shares the summary, chart, and complete text attachment. Public posting rechecks both requester and bot permissions. Mention parsing is disabled.

A failed initial delivery retries the same response, then checks whether Discord already received it. Unconfirmed completed reports can be recovered through `/ai-check` without a new scan until expiry. Sharing uses a synchronous lock and stable nonce. A definite rejection can be retried; an ambiguous outcome disables further posting for that report. Segment pages are generated once per navigation action and never for summary views.

Input attachments are fetched only from Discord attachment hosts, without redirects, with strict UTF-8 decoding and streaming size enforcement. The bot does not fetch source-post URLs. Pasted text goes to the detector, and reports go to Discord. Ephemeral visibility does not prevent either service from receiving the text or determine their retention policies.

Reports expire at the earlier of ten minutes after completion or fourteen minutes after the analysis interaction began. Expiry/restart removes bot-side state, not messages or attachments already delivered. Shutdown drains active handlers before aborting remaining local provider requests. No task recovery or automatic resubmission occurs after restart.

Only fixed operational messages and safe outcome codes are logged. SDK errors, tokens, raw provider responses, pasted text, and interaction payloads are never logged. The private error boundary exposes only deliberately user-facing errors; unexpected failures use a generic private message. There is no command telemetry.

The client subscribes only to Guilds events. Message caching is disabled; user and per-guild member caches are capped at 200 and preserve the bot's own entries. Guild, channel, role, and permission caches retain SDK defaults. The SDK owns reconnects and Discord rate-limit handling; the service's scan cooldown and concurrency limit control provider submissions independently. The local heartbeat requires both Gateway readiness and availability of the configured guild.

## Verification and upkeep

All tests preload a network blocker for fetch, HTTP(S), sockets, TLS, and WebSockets. Providers and REST are injected; SDK tests retain real serialization and caching. Tests cover limits, authorization, uncertain responses, recovery, pagination, native PNG generation, configuration, explicit registration, graceful shutdown, and heartbeat freshness.

The final container smoke test runs non-root, read-only, without credentials or networking. It loads the compiled modules, checks production-only dependencies, native fonts and chart rendering, and heartbeat behavior. CI installs dependencies with the lockfile and audits production packages. GitHub Actions use full commit pins; Dependabot proposes npm, Docker, and Actions updates. Keep `.node-version`, `package.json`'s engine range, and both Docker base stages aligned when updating Node.

CI and publishing use one composite verification action. Publishing tags and pushes the exact image that passed verification in that job, with no second build. No CI or publishing job uses Discord/Pangram credentials, starts the bot, registers commands, or deploys a host.

References: [Discord guidance review](discord-review.md), [Node release policy](https://github.com/nodejs/Release), [discord.js stable releases](https://github.com/discordjs/discord.js/releases), and the pinned dependency source/type definitions used by the tests.
