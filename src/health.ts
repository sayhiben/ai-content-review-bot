import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const HEALTH_FILE = join(tmpdir(), "ai-content-review-bot-health.json");

export function writeHealth(ready: boolean, file = HEALTH_FILE, now = Date.now()): void {
  writeFileSync(file, JSON.stringify({ ready, at: now }), { mode: 0o600 });
}

export function clearHealth(file = HEALTH_FILE): void { rmSync(file, { force: true }); }

export function healthy(file = HEALTH_FILE, now = Date.now()): boolean {
  try {
    const state: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!state || typeof state !== "object" || !("ready" in state) || !("at" in state)) return false;
    return state.ready === true && typeof state.at === "number" && state.at <= now && now - state.at < 60_000;
  } catch { return false; }
}

if (require.main === module) process.exitCode = healthy() ? 0 : 1;
