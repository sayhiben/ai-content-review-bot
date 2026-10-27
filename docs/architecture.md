# Design decisions

## Responsibilities

`main.ts` validates configuration and starts the Discord lifecycle in `bot.ts`. `createAiCheckFeature` composes provider adapters, the scan service, and interaction handlers. It also owns the private error boundary.

`AiCheckInteractions` handles Discord forms, fresh permission checks, navigation, and sharing. `AiCheckService` owns bounded interaction sessions, submission limits, and publish state. `DetectionCache` owns durable reuse of provider analyses. `report.ts` renders the normalized result into an embed, paginated segments, a PNG chart, and a text attachment.

An `AiDetectionProvider` exposes its model identity, explicit version, input limits, and cancellable analysis operation. Add a backend by implementing that contract and adding configuration, composition, and contract fixtures. Provider choice is explicit when more than one backend is available; failures never trigger a scan with another provider.

## Result semantics

Text fractions and document probabilities are separate optional fields. Missing values remain unavailable. Pangram's fractions represent classified text; GPTZero's probabilities concern the document as a whole. An unhighlighted GPTZero sentence remains unclassified, rather than being relabeled human.

Segment positions must match the analyzed text. Pangram offsets are checked as code points and UTF-16 positions; ambiguous matches omit positions. GPTZero sentences must reconstruct the analyzed text in order with only whitespace gaps. Charts preserve overlaps and gaps. Unverified positions or a rendering failure suppress the chart while retaining the full text and labels.

Provider POSTs are never retried automatically. Pangram GET polling can retry transient failures and respects `Retry-After`. Budget lookup is best effort and cannot discard a successful analysis. Reported balances carry their observation time; local usage estimates never become an invented account balance.

## Persistent reuse

Text is normalized to Unicode NFC, line endings become LF, and outer whitespace is trimmed. Case, internal spacing, and paragraph boundaries remain intact because they can affect detection. Exactly that normalized text is sent to the provider.

A SHA-256 hash of the provider ID, model, configured version, and normalized text identifies a row in one SQLite table. The hash input uses a JSON tuple to avoid delimiter ambiguity. SQLite is supplied by Node; no additional database service or ORM is needed.

Before calling a provider, the cache durably reserves the hash. Concurrent identical requests share a promise and receive separate copies of the result. Successful responses replace the reservation and retain the original scan time and budget snapshot. A cache hit does not call the provider or refresh its balance.

Definite initial input, authentication, or quota rejection releases the reservation. Lost responses, malformed results, polling failures, and interrupted processes leave it unresolved: automatically treating these as misses could charge twice. Storage failures fail closed. Administrators investigate unresolved entries before clearing them; see [cache operations](deployment.md#cache-operations).

GPTZero's configured version is sent to its API. Pangram's configured version is a cache generation accompanying the model selector. Administrators must update it when the selected model changes. Persistent entries have no automatic expiry; deleting entries permits repeat paid scans.

## Discord state and privacy

The access policy is a single-server channel-or-role rule with configurable thread inheritance. Initial checks use interaction data; scans, navigation, recovery, and posting fetch current channel/member state. Private threads require membership or Manage Threads permission. Controls bind to requester, guild, channel, and message. Mention parsing is disabled.

Reports start ephemeral. Sharing rechecks the requester and bot's posting permissions. A synchronous lock and Discord nonce prevent duplicate posts within a session; definite rejection permits retry, while an uncertain post remains locked. Private delivery retries editing the same response and checks its receipt before marking the result recoverable.

Interaction sessions are bounded to 100 and expire after ten minutes, capped by the response token deadline. The service permits two concurrent scans, one per user, with a shared 60-second cooldown across providers. These limits require a single worker and are not an account-wide spending cap.

SQLite retains report content and scan metadata. Hashes are identifiers, not anonymization. The database contains no requester IDs or API credentials. Discord and the selected provider receive text independently of local retention. Logs contain fixed messages and safe outcome codes, never raw provider/SDK errors or submitted content.

## Verification

Tests use Node's test runner, real SQLite in temporary directories, actual Discord builders and native PNG rendering, and stubbed external transports. The network guard blocks fetch, HTTP(S), sockets, TLS, and WebSockets. CLI tests run in isolated child processes with stubbed startup/REST dependencies. Coverage includes every compiled application file, including entrypoints, and requires 100% lines, branches, and functions.

CI and publishing share the verification action. The published image is the same image that passed the offline non-root smoke test. Keep the Node version file, package engine, and Docker stages aligned when updating dependencies.
