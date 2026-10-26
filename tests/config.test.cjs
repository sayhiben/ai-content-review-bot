const { test } = require('node:test');
const assert = require('node:assert/strict');
const { botConfig, registrationConfig, ConfigurationError } = require('../dist/config');

const valid = () => ({ DISCORD_TOKEN: 'TEST_ONLY', DISCORD_GUILD_ID: '12345678901234567', ALLOWED_CHANNEL_ID: '12345678901234568', ALLOWED_ROLE_ID: '12345678901234569' });

test('configuration defaults to disabled and does not require provider credentials', () => {
  const config = botConfig(valid());
  assert.equal(config.detection.enabled, false);
  assert.equal(config.detection.apiKey, undefined);
  assert.deepEqual(config.access, { guildId: '12345678901234567', channelId: '12345678901234568', roleId: '12345678901234569', allowThreads: true });
  assert.equal(config.detection.provider, 'pangram');
  assert.equal(config.detection.usdPer100Words, .05);
});

test('enabled configuration validates required IDs, credentials, provider, and pricing without exposing values', () => {
  const env = { ...valid(), AI_DETECTION_ENABLED: 'true', PANGRAM_API_KEY: 'TEST_PROVIDER_KEY' };
  assert.equal(botConfig(env).detection.apiKey, 'TEST_PROVIDER_KEY');
  for (const patch of [
    { DISCORD_TOKEN: '' }, { DISCORD_GUILD_ID: '' }, { ALLOWED_CHANNEL_ID: 'SECRET_BAD_ID' },
    { ALLOWED_ROLE_ID: '' }, { PANGRAM_API_KEY: '' }, { AI_DETECTION_ENABLED: 'yes' }, { ALLOW_CHANNEL_THREADS: 'yes' },
    { PANGRAM_MODEL: ' ' }, { PANGRAM_USD_PER_100_WORDS: 'Infinity' },
    { PANGRAM_USD_PER_100_WORDS: '0' }, { AI_DETECTION_PROVIDER: 'unsupported' },
  ]) assert.throws(() => botConfig({ ...env, ...patch }), error => error instanceof ConfigurationError && !error.message.includes('SECRET'));
});

test('registration uses only Discord configuration, independent of paid scanning', () => {
  const env = { ...valid(), DISCORD_APPLICATION_ID: '12345678901234570' };
  assert.equal(registrationConfig(env).applicationId, env.DISCORD_APPLICATION_ID);
  assert.throws(() => registrationConfig({ ...env, DISCORD_APPLICATION_ID: '' }), ConfigurationError);
});

test('access policy is configurable and missing generic IDs fail closed', () => {
  const env = { ...valid(), ALLOW_CHANNEL_THREADS: 'false' };
  assert.equal(botConfig(env).access.allowThreads, false);
  // Older environment names cannot silently select a community's policy.
  const { ALLOWED_CHANNEL_ID, ALLOWED_ROLE_ID, ...rest } = env;
  assert.throws(() => botConfig({ ...rest, SUBREDDIT_CHANNEL_ID: ALLOWED_CHANNEL_ID, SUBREDDIT_MOD_ROLE_ID: ALLOWED_ROLE_ID }), /ALLOWED_CHANNEL_ID is required/);
});
