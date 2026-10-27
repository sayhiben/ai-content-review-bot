// Mounted into the final image and run with --network none. Never starts the bot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createCanvas } = require('canvas');
const { segmentChart } = require('./dist/aiDetection/report');
const { aiCheckBuilder } = require('./dist/discord/command');
const { healthy, writeHealth, clearHealth } = require('./dist/health');
require('./dist/main');
require('./dist/registerCommands');
assert.notEqual(process.getuid(), 0);
assert.equal(fs.existsSync('./node_modules/typescript'), false);
assert.equal(fs.existsSync('./.env'), false);
assert.equal(aiCheckBuilder().toJSON().name, 'ai-check');
const ctx = createCanvas(200, 50).getContext('2d');
ctx.font = '20px sans-serif';
assert.ok(ctx.measureText('AI Content Review').width > 0);
const text = 'Synthetic report for container validation.';
const png = segmentChart({ analyzedText: text, segments: [{ text, category: 'ai', label: 'Synthetic', range: { start: 0, end: text.length } }] });
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1000);
writeHealth(true); assert.equal(healthy(), true); clearHealth(); assert.equal(healthy(), false);
const { DetectionCache } = require('./dist/aiDetection/DetectionCache');
const path = './data/smoke.sqlite';
async function checkPersistence() {
  const provider = { name: 'Fixture', model: 'fixture', version: 'v1', minimumWords: 1, analyze: async () => ({ provider: 'Fixture', analyzedText: text, segments: [] }) };
  const cache = new DetectionCache(path);
  await cache.analyze('fixture', provider, text, new AbortController().signal); cache.close();
  const reopened = new DetectionCache(path);
  const replay = await reopened.analyze('fixture', { ...provider, analyze: async () => assert.fail('must replay') }, text, new AbortController().signal);
  assert.equal(replay.cached, true); reopened.close(); fs.unlinkSync(path);
  console.log('Non-root runtime, production dependencies, SDK command, native PNG, persistent cache, and health checks passed offline.');
}
void checkPersistence().catch(error => { console.error(error); process.exitCode = 1; });
