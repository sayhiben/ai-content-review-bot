import { AiDetectionConfig } from "./aiDetection/types";
import { AccessConfig } from "./discord/access";

export interface BotConfig {
  token: string;
  access: AccessConfig;
  detection: AiDetectionConfig;
}

/** Contains variable names only; never echo configuration values or secrets. */
export class ConfigurationError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required.`);
  return value;
}

function snowflake(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!/^\d{17,20}$/.test(value)) throw new ConfigurationError(`${name} must be a Discord ID.`);
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name] ?? String(fallback);
  if (value !== "true" && value !== "false") throw new ConfigurationError(`${name} must be true or false.`);
  return value === "true";
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback?: number): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ConfigurationError(`${name} must be a positive number.`);
  return value;
}

export function registrationConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    token: required(env, "DISCORD_TOKEN"),
    applicationId: snowflake(env, "DISCORD_APPLICATION_ID"),
    guildId: snowflake(env, "DISCORD_GUILD_ID"),
  };
}

export function botConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const enabled = boolean(env, "AI_DETECTION_ENABLED", false);
  const model = env.PANGRAM_MODEL?.trim() ?? "pangram-4";
  if (!model) throw new ConfigurationError("PANGRAM_MODEL must not be empty.");
  const detection: AiDetectionConfig = {
    enabled,
    cachePath: env.CACHE_PATH?.trim() || "data/reports.sqlite",
    pangram: {
      enabled: boolean(env, "PANGRAM_ENABLED", true), apiKey: env.PANGRAM_API_KEY?.trim() || undefined,
      model, version: env.PANGRAM_MODEL_VERSION?.trim() || "", usdPer100Words: positiveNumber(env, "PANGRAM_USD_PER_100_WORDS", 0.05)!,
    },
    gptzero: {
      enabled: boolean(env, "GPTZERO_ENABLED", false), apiKey: env.GPTZERO_API_KEY?.trim() || undefined,
      modelVersion: env.GPTZERO_MODEL_VERSION?.trim() || "",
      usdPer1000Words: positiveNumber(env, "GPTZERO_USD_PER_1000_WORDS"),
    },
  };
  if (enabled && ![detection.pangram, detection.gptzero].some(provider => provider.enabled && provider.apiKey)) {
    throw new ConfigurationError("AI_DETECTION_ENABLED requires an enabled provider with PANGRAM_API_KEY or GPTZERO_API_KEY.");
  }
  for (const [provider, version, variable] of [
    [detection.pangram, detection.pangram.version, "PANGRAM_MODEL_VERSION"],
    [detection.gptzero, detection.gptzero.modelVersion, "GPTZERO_MODEL_VERSION"],
  ] as const) {
    if (enabled && provider.enabled && provider.apiKey && (!version || /^(latest|default)$/i.test(version))) {
      throw new ConfigurationError(`${variable} must identify an explicit model version.`);
    }
  }
  return {
    token: required(env, "DISCORD_TOKEN"),
    access: {
      guildId: snowflake(env, "DISCORD_GUILD_ID"),
      channelId: snowflake(env, "ALLOWED_CHANNEL_ID"),
      roleId: snowflake(env, "ALLOWED_ROLE_ID"),
      allowThreads: boolean(env, "ALLOW_CHANNEL_THREADS", true),
    },
    detection,
  };
}
