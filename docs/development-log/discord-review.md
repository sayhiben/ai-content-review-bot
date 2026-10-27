# Discord implementation review

Reviewed against official Discord documentation and the installed stable discord.js 14.27.0 API on 2026-10-26. Research used public documentation; development and tests made no live application-service calls.

| Area and source | Assessment and decision |
| --- | --- |
| [Interaction delivery and acknowledgement](https://docs.discord.com/developers/interactions/receiving-and-responding) | Retain the supported Gateway transport. Document that Interactions Endpoint URL must remain empty because HTTP and Gateway interaction delivery are mutually exclusive. Modal responses are immediate; scan and button handlers acknowledge before fetching current authorization. Tests enforce that order, respecting Discord's three-second acknowledgement window. |
| [Private responses and token lifetime](https://docs.discord.com/developers/interactions/receiving-and-responding) | Set ephemeral visibility on the initial defer. Keep report controls within the 15-minute token lifetime. Sharing sends a separate channel message after an explicit owner action and fresh permission checks; it does not change the private message's visibility. Mention parsing remains disabled. |
| [Guild command registration](https://docs.discord.com/developers/interactions/application-commands) | Replace bulk overwrite with a single-command POST, which updates the matching name/type without deleting unrelated commands. Keep registration explicit and guild-scoped; global-only installation/context fields are omitted. The default CLI operation remains an offline preview. |
| [Gateway intents](https://docs.discord.com/developers/events/gateway) and [permissions](https://docs.discord.com/developers/topics/permissions) | Retain Guilds as the only intent, no privileged intents or Administrator permission. Command access remains channel OR role within one configured guild; fresh member/channel checks and private-thread membership govern scans and sharing. A ready Gateway with an absent/unavailable configured guild now reports unhealthy. |
| [Modal components](https://docs.discord.com/developers/components/using-modal-components) | Use Label-wrapped TextInput and, when both providers are available, a required StringSelect in the same modal. The 4,000-character text input and optional command attachment share the scan workflow; files need only the selection field. |
| [SDK cache customization](https://discordjs.guide/legacy/miscellaneous/cache-customization) | Disable unused message caching and cap user/member caches at 200 entries, preserving the bot itself. Leave unsupported guild/channel/role/permission cache customization alone. Tests exercise real SDK collections, including eviction and bot retention. |
| [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits) | Continue using SDK rate-limit handling rather than hardcoded platform quotas. Existing scan cooldown/concurrency gates serve a different purpose: limiting paid submissions. Keep provider retries and uncertain-submission handling in the adapter/service. |

## Architecture and delivery findings

- Move community channel/role labels to an optional environment example. Use generic IDs and an explicit thread-inheritance setting. Keep one server, one channel and one role; a multi-server configuration framework is unnecessary for this app.
- Separate Discord access configuration from provider configuration. Keep one authorization policy and one report workflow behind the existing provider interface. No plugin registry, new dependency, persistence layer or scoring abstraction is needed.
- Registration previously replaced every command belonging to this application in the guild. A same-name command upsert is the narrower operation.
- Default SDK user/member caches could grow as people used the bot. Supported cache limits bound those retained entries; fresh authorization does not depend on their retention.
- Release verification previously built an image, then publishing built another. A shared composite action now builds and verifies once per job; the release job publishes that same image. Tests, production dependency auditing and the non-root, read-only, network-disabled image smoke test remain required.

## Verification and remaining acceptance

Offline regression tests cover configurable access, stale roles, private threads, acknowledgement ordering, explicit registration, SDK cache behavior, missing-guild health, provider selection, private reports, sharing, provider errors and shared spending gates. Current platform guidance does not establish live provider account compatibility or Discord's deployed permissions. See the [deployment checklist](../deployment.md#verification-and-monitoring) for acceptance checks. Pangram retains estimated cost and unavailable balance; GPTZero uses a best-effort observed word quota and optional cost estimate.
