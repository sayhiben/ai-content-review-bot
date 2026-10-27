import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AiCheckError, AiDetectionProvider, DetectionResult, ScanRejected } from "./types";

export interface CachedAnalysis { result: DetectionResult; scannedAt: number; cached: boolean }

/** Keep paragraph boundaries and case: both can affect a detector's classification. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export function detectionKey(providerId: string, model: string, version: string, text: string): string {
  return createHash("sha256").update(JSON.stringify([providerId, model, version, normalizeText(text)])).digest("hex");
}

export class DetectionCache {
  private readonly database: DatabaseSync;
  private readonly pending = new Map<string, Promise<CachedAnalysis>>();

  constructor(path: string, private readonly now: () => number = Date.now) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec(`CREATE TABLE IF NOT EXISTS analyses (
      key TEXT PRIMARY KEY, result TEXT, scanned_at INTEGER NOT NULL
    ) STRICT`);
  }

  async analyze(providerId: string, provider: AiDetectionProvider, text: string, signal: AbortSignal): Promise<CachedAnalysis> {
    const key = detectionKey(providerId, provider.model, provider.version, text);
    // Concurrent requests share one paid submission, but receive separate report objects.
    const pending = this.pending.get(key);
    if (pending) return { ...structuredClone(await pending), cached: true };
    const stored = this.database.prepare("SELECT result, scanned_at FROM analyses WHERE key = ?").get(key);
    if (stored) {
      if (stored.result === null) throw new AiCheckError("cache_pending", "A previous scan of this text is unconfirmed. Ask an administrator to check it before retrying.");
      return { result: JSON.parse(stored.result as string), scannedAt: stored.scanned_at as number, cached: true };
    }
    signal.throwIfAborted();
    // Reserve durably before submission: a crash or lost response must not trigger a second charge.
    this.database.prepare("INSERT INTO analyses (key, scanned_at) VALUES (?, ?)").run(key, this.now());
    const scan = this.scan(key, provider, normalizeText(text), signal);
    this.pending.set(key, scan);
    try { return structuredClone(await scan); }
    finally { this.pending.delete(key); }
  }

  private async scan(key: string, provider: AiDetectionProvider, text: string, signal: AbortSignal): Promise<CachedAnalysis> {
    let result: DetectionResult;
    try { result = await provider.analyze(text, { signal }); }
    catch (error) {
      // Explicit input/auth/quota rejection did not create an analysis. Other failures are ambiguous.
      if (error instanceof ScanRejected) {
        this.database.prepare("DELETE FROM analyses WHERE key = ?").run(key);
      }
      throw error;
    }
    const scannedAt = this.now();
    // A storage failure must be visible; silently treating it as a miss would repeat paid work.
    try {
      this.database.prepare("UPDATE analyses SET result = ?, scanned_at = ? WHERE key = ?")
        .run(JSON.stringify(result), scannedAt, key);
    } catch {
      throw new AiCheckError("cache_write", "The scan completed, but saving it failed. Contact an administrator before retrying.");
    }
    return { result, scannedAt, cached: false };
  }

  close(): void { if (this.database.isOpen) this.database.close(); }
}
