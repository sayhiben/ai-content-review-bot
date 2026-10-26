const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerCommands } = require('../dist/registerCommands');

test('command registration defaults to an offline preview with guild-only, unrestricted role visibility', async () => {
  const output = [];
  await registerCommands([], {}, { put: async () => assert.fail('dry run must not write') }, text => output.push(text));
  const [command] = JSON.parse(output[0]);
  assert.equal(command.name, 'ai-check');
  assert.equal(command.contexts, undefined);
  assert.equal(command.integration_types, undefined);
  assert.equal(command.default_member_permissions, undefined);
  assert.equal(command.options[0].type, 11);
});

test('explicit registration writes only this application and configured guild using injected REST', async () => {
  const requests = [];
  const env = { DISCORD_TOKEN: 'TEST_ONLY', DISCORD_APPLICATION_ID: '12345678901234567', DISCORD_GUILD_ID: '12345678901234568' };
  await registerCommands(['--apply'], env, { put: async (...args) => requests.push(args) }, () => {});
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/applications/12345678901234567/guilds/12345678901234568/commands');
  assert.equal(requests[0][1].body.length, 1);
  await assert.rejects(registerCommands(['--typo'], env, { put: async () => assert.fail('must not write') }), /Usage/);
});
