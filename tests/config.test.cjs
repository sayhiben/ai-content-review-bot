const { test } = require('node:test');
const assert = require('node:assert/strict');
const { botConfig, registrationConfig, ConfigurationError } = require('../dist/config');
const valid = () => ({ DISCORD_TOKEN: 'TEST_ONLY', DISCORD_GUILD_ID: '12345678901234567', ALLOWED_CHANNEL_ID: '12345678901234568', ALLOWED_ROLE_ID: '12345678901234569' });
const enabled = () => ({ ...valid(), AI_DETECTION_ENABLED: 'true', PANGRAM_API_KEY: 'TEST_ONLY', PANGRAM_MODEL_VERSION: 'fixture-v1' });

test('paid scanning defaults to disabled', () => assert.equal(botConfig(valid()).detection.enabled, false));
test('cache defaults to a persistent database', () => assert.equal(botConfig(valid()).detection.cachePath, 'data/reports.sqlite'));
test('cache location is configurable', () => assert.equal(botConfig({ ...valid(), CACHE_PATH: ' custom.sqlite ' }).detection.cachePath, 'custom.sqlite'));
test('thread inheritance is configurable', () => assert.equal(botConfig({ ...valid(), ALLOW_CHANNEL_THREADS: 'false' }).access.allowThreads, false));
test('Pangram defaults to enabled', () => assert.equal(botConfig(valid()).detection.pangram.enabled, true));
test('GPTZero defaults to disabled', () => assert.equal(botConfig(valid()).detection.gptzero.enabled, false));
test('enabled configuration accepts explicit versions', () => assert.equal(botConfig(enabled()).detection.pangram.version, 'fixture-v1'));
for (const [variable, value] of [
  ['DISCORD_TOKEN', ''], ['DISCORD_GUILD_ID', ''], ['ALLOWED_CHANNEL_ID', 'SECRET_BAD_ID'], ['ALLOWED_ROLE_ID', ''],
  ['PANGRAM_API_KEY', ''], ['AI_DETECTION_ENABLED', 'yes'], ['ALLOW_CHANNEL_THREADS', 'yes'], ['PANGRAM_MODEL', ' '],
  ['PANGRAM_USD_PER_100_WORDS', 'Infinity'], ['PANGRAM_USD_PER_100_WORDS', '0'], ['GPTZERO_USD_PER_1000_WORDS', '-1'],
  ['GPTZERO_USD_PER_1000_WORDS', 'NaN'], ['GPTZERO_ENABLED', 'yes'], ['PANGRAM_ENABLED', 'yes'],
  ['PANGRAM_MODEL_VERSION', ''], ['PANGRAM_MODEL_VERSION', 'latest'], ['PANGRAM_MODEL_VERSION', 'DEFAULT'],
]) {
  test(`${variable} rejects ${JSON.stringify(value)} without exposing secrets`, () => {
    assert.throws(() => botConfig({ ...enabled(), [variable]: value }), e => e instanceof ConfigurationError && !e.message.includes('SECRET'));
  });
}
for (const version of ['', 'latest', 'default']) {
  test(`GPTZero rejects unspecified version ${JSON.stringify(version)}`, () => {
    assert.throws(() => botConfig({ ...enabled(), GPTZERO_ENABLED: 'true', GPTZERO_API_KEY: 'TEST_ONLY', GPTZERO_MODEL_VERSION: version }), /GPTZERO_MODEL_VERSION/);
  });
}
test('GPTZero can run independently', () => {
  const config = botConfig({ ...valid(), AI_DETECTION_ENABLED: 'true', PANGRAM_ENABLED: 'false', GPTZERO_ENABLED: 'true', GPTZERO_API_KEY: 'TEST_ONLY', GPTZERO_MODEL_VERSION: 'v1' });
  assert.equal(config.detection.gptzero.modelVersion, 'v1');
  assert.equal(config.detection.pangram.enabled, false);
});
test('both providers can be enabled together', () => {
  const config = botConfig({ ...enabled(), GPTZERO_ENABLED: 'true', GPTZERO_API_KEY: 'TEST_ONLY', GPTZERO_MODEL_VERSION: 'v1' });
  assert.ok(config.detection.pangram.enabled && config.detection.gptzero.enabled);
});
test('unavailable providers do not require model versions', () => {
  assert.equal(botConfig({ ...enabled(), GPTZERO_ENABLED: 'true' }).detection.gptzero.apiKey, undefined);
});
test('rates are configurable per provider', () => {
  const config = botConfig({ ...valid(), PANGRAM_USD_PER_100_WORDS: '0.1', GPTZERO_USD_PER_1000_WORDS: '0.2' });
  assert.equal(config.detection.pangram.usdPer100Words, .1);
  assert.equal(config.detection.gptzero.usdPer1000Words, .2);
});
test('registration needs no detection credentials', () => {
  const env = { ...valid(), DISCORD_APPLICATION_ID: '12345678901234570' };
  assert.equal(registrationConfig(env).applicationId, env.DISCORD_APPLICATION_ID);
});
test('registration requires the application ID', () => assert.throws(() => registrationConfig(valid()), /DISCORD_APPLICATION_ID/));
test('configuration reads the process environment by default', t => {
  for (const [key, value] of Object.entries({ ...valid(), DISCORD_APPLICATION_ID: '12345678901234570' })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  }
  assert.equal(botConfig().token, 'TEST_ONLY');
  assert.equal(registrationConfig().applicationId, '12345678901234570');
});
