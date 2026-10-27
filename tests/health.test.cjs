const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { healthy, writeHealth, clearHealth } = require('../dist/health');
function file(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-health-')); t.after(() => rmSync(dir, { recursive: true }));
  return join(dir, 'health.json');
}
test('missing heartbeat is unhealthy', t => assert.equal(healthy(file(t)), false));
test('recent ready heartbeat is healthy', t => {
  const path = file(t); writeHealth(true, path, 1000); assert.equal(healthy(path, 1001), true);
});
test('stale heartbeat is unhealthy', t => {
  const path = file(t); writeHealth(true, path, 1000); assert.equal(healthy(path, 61000), false);
});
test('future heartbeat is unhealthy', t => {
  const path = file(t); writeHealth(true, path, 1000); assert.equal(healthy(path, 999), false);
});
test('non-ready heartbeat is unhealthy', t => {
  const path = file(t); writeHealth(false, path, 1000); assert.equal(healthy(path, 1001), false);
});
test('malformed heartbeat is unhealthy', t => {
  const path = file(t); writeFileSync(path, 'not json'); assert.equal(healthy(path), false);
});
test('clearing a heartbeat removes readiness', t => {
  const path = file(t); writeHealth(true, path); clearHealth(path); assert.equal(healthy(path), false);
});
for (const state of [null, false, {}, { ready: true }, { at: 1000 }, { ready: true, at: '1000' }]) {
  test(`invalid heartbeat ${JSON.stringify(state)} is unhealthy`, t => {
    const path = file(t); writeFileSync(path, JSON.stringify(state)); assert.equal(healthy(path, 1000), false);
  });
}
