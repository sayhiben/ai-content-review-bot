const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { healthy, writeHealth, clearHealth } = require('../dist/health');

test('health reflects readiness, recency, malformed data, and shutdown without networking', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-health-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, 'health.json');
  assert.equal(healthy(file, 1000), false);
  writeHealth(true, file, 1000); assert.equal(healthy(file, 1001), true);
  assert.equal(healthy(file, 61000), false); assert.equal(healthy(file, 999), false);
  writeHealth(false, file, 1000); assert.equal(healthy(file, 1001), false);
  writeFileSync(file, 'not json'); assert.equal(healthy(file, 1001), false);
  clearHealth(file); assert.equal(healthy(file, 1001), false);
});
