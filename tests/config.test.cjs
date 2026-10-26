const { test } = require('node:test');
const assert = require('node:assert/strict');
const { botConfig, registrationConfig, ConfigurationError } = require('../dist/config');

const valid = () => ({ DISCORD_TOKEN: 'TEST_ONLY', DISCORD_GUILD_ID: '12345678901234567', ALLOWED_CHANNEL_ID: '12345678901234568', ALLOWED_ROLE_ID: '12345678901234569' });

test('configuration defaults to disabled and does not require provider credentials', () => {
  const config = botConfig(valid());
  assert.equal(config.detection.enabled, false);
  assert.equal(config.detection.pangram.apiKey, undefined);
  assert.deepEqual(config.access, { guildId: '12345678901234567', channelId: '12345678901234568', roleId: '12345678901234569', allowThreads: true });
  assert.equal(config.detection.pangram.enabled, true);
  assert.equal(config.detection.gptzero.enabled, false);
  assert.equal(config.detection.pangram.usdPer100Words, .05);
  assert.equal(config.detection.gptzero.usdPer1000Words, undefined);
});

test('enabled configuration validates required IDs, credentials, provider, and pricing without exposing values', () => {
  const env = { ...valid(), AI_DETECTION_ENABLED: 'true', PANGRAM_API_KEY: 'TEST_PROVIDER_KEY' };
  assert.equal(botConfig(env).detection.pangram.apiKey, 'TEST_PROVIDER_KEY');
  for (const patch of [
    { DISCORD_TOKEN: '' }, { DISCORD_GUILD_ID: '' }, { ALLOWED_CHANNEL_ID: 'SECRET_BAD_ID' },
    { ALLOWED_ROLE_ID: '' }, { PANGRAM_API_KEY: '' }, { AI_DETECTION_ENABLED: 'yes' }, { ALLOW_CHANNEL_THREADS: 'yes' },
    { PANGRAM_MODEL: ' ' }, { PANGRAM_USD_PER_100_WORDS: 'Infinity' },
    { PANGRAM_USD_PER_100_WORDS: '0' }, { AI_DETECTION_PROVIDER: 'pangram' },
    { GPTZERO_USD_PER_1000_WORDS: '-1' }, { GPTZERO_USD_PER_1000_WORDS: 'NaN' },
    { GPTZERO_ENABLED: 'yes' }, { PANGRAM_ENABLED: 'yes' },
  ]) assert.throws(() => botConfig({ ...env, ...patch }), error => error instanceof ConfigurationError && !error.message.includes('SECRET'));
});

test('providers may be independently enabled; a missing key only removes that backend', () => {
  const env = { ...valid(), AI_DETECTION_ENABLED: 'true', GPTZERO_ENABLED: 'true', GPTZERO_API_KEY: 'TEST_ZERO_KEY' };
  const zero = botConfig({ ...env, PANGRAM_ENABLED: 'false', GPTZERO_MODEL_VERSION: 'fixture-version', GPTZERO_USD_PER_1000_WORDS: '0.1' });
  assert.equal(zero.detection.pangram.enabled, false);
  assert.equal(zero.detection.gptzero.modelVersion, 'fixture-version');
  assert.equal(zero.detection.gptzero.usdPer1000Words, .1);
  assert.equal(botConfig(env).detection.pangram.apiKey, undefined);
  const both = botConfig({ ...env, PANGRAM_API_KEY: 'TEST_PANGRAM_KEY' });
  assert.ok(both.detection.pangram.enabled && both.detection.gptzero.enabled);
  assert.throws(() => botConfig({ ...env, GPTZERO_ENABLED: 'false' }), /enabled provider/);
  assert.equal(botConfig({ ...env, AI_DETECTION_ENABLED: 'false', GPTZERO_API_KEY: '' }).detection.enabled, false);
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
