const { test } = require('node:test');
const assert = require('node:assert/strict');
const { botConfig, registrationConfig, ConfigurationError } = require('../dist/config');

const valid = () => ({ DISCORD_TOKEN: 'TEST_ONLY', DISCORD_GUILD_ID: '12345678901234567', SUBREDDIT_CHANNEL_ID: '12345678901234568', SUBREDDIT_MOD_ROLE_ID: '12345678901234569' });

test('configuration defaults to disabled and does not require provider credentials', () => {
  const config = botConfig(valid());
  assert.equal(config.detection.enabled, false);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.detection.provider, 'pangram');
  assert.equal(config.detection.usdPer100Words, .05);
});

test('enabled configuration validates required IDs, credentials, provider, and pricing without exposing values', () => {
  const env = { ...valid(), AI_DETECTION_ENABLED: 'true', PANGRAM_API_KEY: 'TEST_PROVIDER_KEY' };
  assert.equal(botConfig(env).apiKey, 'TEST_PROVIDER_KEY');
  for (const patch of [
    { DISCORD_TOKEN: '' }, { DISCORD_GUILD_ID: '' }, { SUBREDDIT_CHANNEL_ID: 'SECRET_BAD_ID' },
    { SUBREDDIT_MOD_ROLE_ID: '' }, { PANGRAM_API_KEY: '' }, { AI_DETECTION_ENABLED: 'yes' },
    { PANGRAM_MODEL: ' ' }, { PANGRAM_USD_PER_100_WORDS: 'Infinity' },
    { PANGRAM_USD_PER_100_WORDS: '0' }, { AI_DETECTION_PROVIDER: 'unsupported' },
  ]) assert.throws(() => botConfig({ ...env, ...patch }), error => error instanceof ConfigurationError && !error.message.includes('SECRET'));
});

test('registration uses only Discord configuration, independent of paid scanning', () => {
  const env = { ...valid(), DISCORD_APPLICATION_ID: '12345678901234570' };
  assert.equal(registrationConfig(env).applicationId, env.DISCORD_APPLICATION_ID);
  assert.throws(() => registrationConfig({ ...env, DISCORD_APPLICATION_ID: '' }), ConfigurationError);
});

module.exports.valid = valid;
