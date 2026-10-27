const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DetectionCache, normalizeText, detectionKey } = require('../dist/aiDetection/DetectionCache');
const { ScanRejected } = require('../dist/aiDetection/types');
const { provider, result, deferred } = require('./fixtures.cjs');
const signal = () => new AbortController().signal;
const setup = t => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-cache-'));
  const path = join(directory, 'nested', 'reports.sqlite');
  const cache = new DetectionCache(path, () => 1234);
  t.after(() => { cache.close(); rmSync(directory, { recursive: true, force: true }); });
  return { cache, path };
};

test('normalization trims, canonicalizes Unicode and standardizes newlines', () => {
  assert.equal(normalizeText(' \r\nCafe\u0301\r\nnext\rlast \t'), 'Café\nnext\nlast');
});
test('normalization preserves case, paragraph breaks and internal spaces', () => {
  const text = 'A  sentence\n\nAnother sentence.';
  assert.equal(normalizeText(text), text);
});
test('equivalent normalized texts share a hash', () => {
  assert.equal(detectionKey('p', 'm', 'v', ' Café\r\nx '), detectionKey('p', 'm', 'v', 'Cafe\u0301\nx'));
});
for (const [index, name] of ['provider', 'model', 'version', 'text'].entries()) {
  test(`changing ${name} changes the cache key`, () => {
    const first = ['p', 'm', 'v', 'text']; const second = [...first]; second[index] += '2';
    assert.notEqual(detectionKey(...first), detectionKey(...second));
  });
}
test('hash components cannot collide through delimiter placement', () => {
  assert.notEqual(detectionKey('p:m', 'v', '1', 'text'), detectionKey('p', 'm:v', '1', 'text'));
});
test('first scan sends exactly the normalized text and stores its date', async t => {
  const { cache } = setup(t);
  const scan = t.mock.fn(async input => result(input));
  const analysis = await cache.analyze('p', provider({ analyze: scan }), ' Café\r\ntext ', signal());
  assert.equal(scan.mock.calls[0].arguments[0], 'Café\ntext');
  assert.equal(analysis.scannedAt, 1234);
  assert.equal(analysis.cached, false);
});
test('repeated text replays without calling the provider', async t => {
  const { cache } = setup(t);
  const scan = t.mock.fn(async input => result(input)); const p = provider({ analyze: scan });
  await cache.analyze('p', p, 'text', signal());
  const replay = await cache.analyze('p', p, ' text ', signal());
  assert.equal(scan.mock.callCount(), 1);
  assert.equal(replay.cached, true);
});
test('cache survives closing and reopening the database', async t => {
  const { cache, path } = setup(t);
  await cache.analyze('p', provider(), 'text', signal()); cache.close();
  const reopened = new DetectionCache(path); t.after(() => reopened.close());
  const replay = await reopened.analyze('p', provider({ analyze: async () => assert.fail('must replay') }), 'text', signal());
  assert.equal(replay.scannedAt, 1234);
  reopened.close();
});
test('simultaneous identical requests share one scan', async t => {
  const { cache } = setup(t); const gate = deferred();
  const scan = t.mock.fn(() => gate.promise); const p = provider({ analyze: scan });
  const first = cache.analyze('p', p, 'text', signal());
  const second = cache.analyze('p', p, 'text', signal());
  gate.resolve(result('text'));
  assert.equal((await first).cached, false);
  assert.equal((await second).cached, true);
  assert.equal(scan.mock.callCount(), 1);
});
test('each requester receives an independent result object', async t => {
  const { cache } = setup(t); const gate = deferred(); const p = provider({ analyze: () => gate.promise });
  const first = cache.analyze('p', p, 'text', signal()); const second = cache.analyze('p', p, 'text', signal());
  gate.resolve(result('text'));
  const a = await first; const b = await second; a.result.segments[0].text = 'changed';
  assert.equal(b.result.segments[0].text, 'text');
  assert.equal((await cache.analyze('p', p, 'text', signal())).result.segments[0].text, 'text');
});
test('different provider versions create separate analyses', async t => {
  const { cache } = setup(t); const scan = t.mock.fn(async input => result(input));
  await cache.analyze('p', provider({ analyze: scan }), 'text', signal());
  await cache.analyze('p', provider({ analyze: scan, version: 'v2' }), 'text', signal());
  assert.equal(scan.mock.callCount(), 2);
});
test('a definite submission rejection releases the reservation', async t => {
  const { cache } = setup(t);
  await assert.rejects(cache.analyze('p', provider({ analyze: async () => { throw new ScanRejected('quota', 'No quota'); } }), 'text', signal()), { code: 'quota' });
  assert.equal((await cache.analyze('p', provider(), 'text', signal())).cached, false);
});
test('ambiguous failures cannot cause a second paid submission', async t => {
  const { cache, path } = setup(t);
  await assert.rejects(cache.analyze('p', provider({ analyze: async () => { throw new Error('lost response'); } }), 'text', signal()));
  cache.close();
  const reopened = new DetectionCache(path); t.after(() => reopened.close());
  await assert.rejects(reopened.analyze('p', provider({ analyze: async () => assert.fail('must not resubmit') }), 'text', signal()), { code: 'cache_pending' });
  reopened.close();
});
test('aborted requests do not create a reservation', async t => {
  const { cache } = setup(t);
  await assert.rejects(cache.analyze('p', provider(), 'text', AbortSignal.abort()));
  assert.equal((await cache.analyze('p', provider(), 'text', signal())).cached, false);
});
test('database write failure preserves the reservation and reports the failure', async t => {
  const { cache, path } = setup(t);
  const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON analyses BEGIN SELECT RAISE(ABORT, 'disk failure'); END"); db.close();
  await assert.rejects(cache.analyze('p', provider(), 'text', signal()), { code: 'cache_write' });
  await assert.rejects(cache.analyze('p', provider(), 'text', signal()), { code: 'cache_pending' });
});
test('unreadable cache never falls through to a paid call', async t => {
  const { cache } = setup(t); cache.close();
  await assert.rejects(cache.analyze('p', provider({ analyze: async () => assert.fail('must not submit') }), 'text', signal()));
});
