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

export function registrationConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    token: required(env, "DISCORD_TOKEN"),
    applicationId: snowflake(env, "DISCORD_APPLICATION_ID"),
    guildId: snowflake(env, "DISCORD_GUILD_ID"),
  };
}

export function botConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const enabled = boolean(env, "AI_DETECTION_ENABLED", false);
  if ((env.AI_DETECTION_PROVIDER ?? "pangram") !== "pangram") throw new ConfigurationError("AI_DETECTION_PROVIDER is unsupported.");
  const model = env.PANGRAM_MODEL?.trim() ?? "pangram-4";
  const usdPer100Words = Number(env.PANGRAM_USD_PER_100_WORDS ?? "0.05");
  if (!model) throw new ConfigurationError("PANGRAM_MODEL must not be empty.");
  if (!Number.isFinite(usdPer100Words) || usdPer100Words <= 0) throw new ConfigurationError("PANGRAM_USD_PER_100_WORDS must be a positive number.");
  return {
    token: required(env, "DISCORD_TOKEN"),
    access: {
      guildId: snowflake(env, "DISCORD_GUILD_ID"),
      channelId: snowflake(env, "ALLOWED_CHANNEL_ID"),
      roleId: snowflake(env, "ALLOWED_ROLE_ID"),
      allowThreads: boolean(env, "ALLOW_CHANNEL_THREADS", true),
    },
    detection: {
      enabled, provider: "pangram", model, usdPer100Words,
      apiKey: enabled ? required(env, "PANGRAM_API_KEY") : env.PANGRAM_API_KEY?.trim(),
    },
  };
}
