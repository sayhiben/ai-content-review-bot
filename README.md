# AI Content Review Bot

A Discord bot that checks pasted posts, comments, and text files with Pangram or GPTZero.

`/ai-check` returns a private summary, segment chart, and full text report. **Post to channel** shares the report and its text in the original channel. Reports support human review; the bot does not take moderation actions.

## Usage

- Paste up to 4,000 characters, or attach a UTF-8 `.txt` file. Submissions must contain 50–5,000 words and fit within 256 KiB; GPTZero also limits text to 150,000 characters.
- Choose a provider when both are configured. A single available provider is selected automatically.
- Pangram reports percentages of classified text. GPTZero reports document probabilities and sentence highlights; probabilities are not percentages of text.
- Reports include estimated scan cost and an observed balance when available. Pangram balance is unavailable. GPTZero reports remaining words with the observation time.
- Identical normalized text uses the saved result for that provider, model, and configured version. Cached reports incur no new scan charge. Saved results survive restarts.
- Report controls last up to ten minutes. Submit the same text again to retrieve a saved result. If delivery fails while controls are active, run `/ai-check` without a file to recover it.

Access requires the configured channel **or** role, within the configured server. Direct child threads can inherit channel access. Only the requester can use report controls; access is checked again before reading or sharing a report.

## Setup

Use the Node version in [.node-version](.node-version).

```sh
npm ci
npm run check
npm run commands
```

Tests block network connections and use synthetic data. `npm run check` requires **100% line, branch, and function coverage** across the application, including CLI entrypoints. The LCOV report is written to `coverage/lcov.info` and saved by CI. Command preview requires no credentials.

Copy [.env.example](.env.example) to `.env`, then follow [deployment](docs/deployment.md) to configure the Discord application, providers, model versions, and persistent storage. Scanning defaults to disabled. Community-specific IDs belong in configuration; see the optional [Seattle example](examples/seattle.env.example).

`npm start` connects to Discord. `npm run commands -- --apply` registers the guild command. CI does neither.

## Storage and privacy

The local SQLite database retains report text, segment details, and scan-time budget information until an administrator removes it. Hashing identifies duplicate submissions; it does **not** anonymize stored reports. Protect the database and its backups as submitted content. Discord and the selected provider also receive the text under their own retention policies.

Run one instance with a persistent cache volume. One scan per user, two concurrent scans, and a 60-second submission cooldown limit requests. Use provider-side spending controls for an account budget cap. An unconfirmed paid scan stays blocked from resubmission until an administrator investigates.

## Deployment and maintenance

CI checks types, tests and coverage, production dependencies, and a container smoke test with networking disabled. The smoke test verifies non-root execution, native chart rendering, cache persistence, and health checks.

The **Publish container** workflow runs on `v*` tags or manual dispatch and publishes the tested image to `ghcr.io/sayhiben/ai-content-review-bot`. Deploy by digest and retain a verified image and matching configuration for rollback.

See [deployment](docs/deployment.md), [design decisions](docs/architecture.md), and [LICENSE](LICENSE).
