const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, basename } = require('node:path');
const { writeHealth, HEALTH_FILE } = require('../dist/health');

function run(t, script, mode, args = []) {
  const temporary = mkdtempSync(join(tmpdir(), 'ai-cli-'));
  if (mode === 'health-ready') writeHealth(true, join(temporary, basename(HEALTH_FILE)));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  return spawnSync(process.execPath, ['--require', './tests/offline.cjs', '--require', './tests/cli-fixture.cjs', `dist/${script}.js`, ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, TEST_CLI_MODE: mode, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
  });
}
for (const mode of ['main-sigterm', 'main-sigint']) {
  test(`${mode} drains and exits successfully`, t => {
    const child = run(t, 'main', mode);
    assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Stopped fixture bot/);
  });
}
test('failed shutdown exits unsuccessfully', t => assert.equal(run(t, 'main', 'main-stop-error').status, 1));
test('failed login cleans up and reports a safe error', t => {
  const child = run(t, 'main', 'main-login-error');
  assert.equal(child.status, 1); assert.match(child.stdout, /Stopped fixture bot/);
  assert.match(child.stderr, /Bot startup failed/); assert.doesNotMatch(child.stderr, /SECRET/);
});
test('startup reports configuration errors by variable name', t => {
  const child = run(t, 'main', 'main-config-error');
  assert.equal(child.status, 1); assert.match(child.stderr, /DISCORD_TOKEN is required/);
});
test('registration CLI previews commands without credentials', t => {
  const child = run(t, 'registerCommands', 'preview');
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).name, 'ai-check');
});
test('registration CLI applies through the REST transport', t => {
  const child = run(t, 'registerCommands', 'register-success', ['--apply']);
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Registered fixture command/);
});
test('registration CLI rejects unknown flags', t => {
  const child = run(t, 'registerCommands', 'preview', ['--typo']);
  assert.equal(child.status, 1); assert.match(child.stderr, /Usage/);
});
test('registration CLI sanitizes REST errors', t => {
  const child = run(t, 'registerCommands', 'register-error', ['--apply']);
  assert.equal(child.status, 1); assert.match(child.stderr, /Command registration failed/);
  assert.doesNotMatch(child.stderr, /SECRET/);
});
for (const [mode, expected] of [['health-ready', 0], ['health-missing', 1]]) {
  test(`health CLI reports ${mode}`, t => assert.equal(run(t, 'health', mode).status, expected));
}
