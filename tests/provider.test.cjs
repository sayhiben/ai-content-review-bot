const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PangramProvider, normalizePangram } = require('../dist/aiDetection/PangramProvider');
const { text, pangram, json } = require('./fixtures.cjs');

test('submit once, poll, preserve qualifications and usage; never create public dashboard links', async () => {
  const calls = [];
  const replies = [json({ task_id: 'task' }), json({ stage: 'STAGE_PREPROCESSING' }), json(pangram())];
  const provider = new PangramProvider('TEST_ONLY_KEY', 'pangram-4', 'fixture-v1', 0.05, async (url, options) => {
    calls.push({ url, options }); return replies.shift();
  }, async () => {});
  const r = await provider.analyze(text, { signal: new AbortController().signal });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { text, model: 'pangram-4', public_dashboard_link: false });
  assert.equal(calls[0].options.headers['x-api-key'], 'TEST_ONLY_KEY');
  assert.equal(r.headline, 'Possibly AI'); assert.equal(r.segments[0].confidence, 'Low');
  assert.equal(r.version, 'fixture-4.1'); assert.equal(r.usage.estimated, true);
  assert.equal(r.balance, undefined);
});

for (const [label, key] of [['Human Written', 'human'], ['AI-Assisted', 'assisted'], ['AI-Generated', 'ai']]) {
  test(`Pangram maps ${label} to ${key}`, () => {
    const r = normalizePangram(pangram(text, label), 'pangram-4');
    assert.equal(r.textFractions[key], 1); assert.equal(r.segments[0].category, key);
  });
}
test('Pangram preserves mixed text fractions', () => {
  const p = pangram(); p.fraction_ai = 0.2; p.fraction_ai_assisted = 0.3; p.fraction_human = 0.5;
  assert.deepEqual(normalizePangram(p, 'pangram-4').textFractions, { ai: .2, assisted: .3, human: .5 });
});

for (const [unit, start, end] of [['code points', 8, 13], ['UTF-16', 9, 14]]) {
  test(`Pangram verifies ${unit} offsets against Unicode text`, () => {
    const p = pangram('🙂 café. café.');
    p.windows = [{ text: 'café.', label: 'New label', start_index: start, end_index: end }];
    const r = normalizePangram(p, 'pangram-4');
    assert.deepEqual(r.segments[0].range, { start: 9, end: 14 });
  });
}
test('Pangram keeps unfamiliar labels unclassified', () => {
  const body = pangram(); body.windows[0].label = 'New label';
  const r = normalizePangram(body, 'pangram-4');
  assert.equal(r.segments[0].category, 'unknown');
});
test('Pangram omits mismatched positions', () => {
  const p = pangram('🙂 café. café.');
  p.windows = [{ text: 'café.', label: 'New label', start_index: 1, end_index: 14 }];
  const r = normalizePangram(p, 'pangram-4');
  assert.equal(r.segments[0].category, 'unknown');
  assert.equal(r.segments[0].range, undefined);
});

test('preserves overlaps and gaps without changing provider aggregate fractions', () => {
  const p = pangram('abcdef');
  p.windows = [
    { text: 'abc', label: 'AI-Generated', start_index: 0, end_index: 3 },
    { text: 'bcde', label: 'Human Written', start_index: 1, end_index: 5 },
  ];
  const r = normalizePangram(p, 'pangram-4');
  assert.equal(r.segments.length, 2); assert.equal(r.textFractions.ai, 1);
  assert.equal(r.segments[1].range.end, 5);
});

test('ambiguous Unicode offset conventions omit positions instead of choosing a repeated occurrence', () => {
  const p = pangram('🙂aaaaaaaaaaaa');
  p.windows = [{ text: 'aaa', label: 'AI-Generated', start_index: 2, end_index: 5 }];
  const r = normalizePangram(p, 'pangram-4');
  assert.equal(r.segments[0].range, undefined);
  assert.equal(r.segments[0].text, 'aaa');
  assert.equal(r.textFractions.ai, 1);
});

test('coinciding offset interpretations preserve valid repeated-text positions', () => {
  const p = pangram('aaaaaaaaaaaa');
  p.windows = [{ text: 'aaa', label: 'AI-Generated', start_index: 2, end_index: 5 }];
  assert.deepEqual(normalizePangram(p, 'pangram-4').segments[0].range, { start: 2, end: 5 });
});

for (const change of [{ fraction_ai: NaN }, { fraction_ai: -1 }, { fraction_ai: 2 }, { text: '' }, { windows: [{}] }]) {
  test(`Pangram rejects invalid result ${JSON.stringify(change)}`, () => {
    assert.throws(() => normalizePangram({ ...pangram(), ...change }, 'pangram-4'), { code: 'response' });
  });
}
for (const [name, terminal] of [['failed task', () => json({ stage: 'STAGE_FAILED', headline: text })], ['malformed JSON', () => new Response('{bad')]]) {
  test(`Pangram rejects ${name} without disclosing submitted text`, async () => {
    const replies = [json({ task_id: 'task' }), terminal()];
    const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => replies.shift(), async () => {});
    await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), e => !e.message.includes(text));
  });
}

for (const status of [401, 402, 403, 404, 422, 429, 500, 503]) {
  test(`Pangram does not retry HTTP ${status} submissions`, async () => {
    let calls = 0;
    const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => { calls++; return json({ secret: text }, status); });
    await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), { code: `http_${status}` });
    assert.equal(calls, 1);
  });
}
test('Pangram does not retry an unconfirmed transport failure', async () => {
  let calls = 0;
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => { calls++; throw new Error(text); });
  await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), { code: 'connection' });
  assert.equal(calls, 1);
});

test('polling retries transport/5xx/429 failures and honors Retry-After', async () => {
  const delays = [];
  const replies = [json({ task_id: 'task' }), new Error('network'), json({}, 503), json({}, 429, { 'Retry-After': '12' }), json(pangram())];
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => {
    const next = replies.shift(); if (next instanceof Error) throw next; return next;
  }, async ms => { delays.push(ms); });
  await provider.analyze(text, { signal: new AbortController().signal });
  assert.ok(delays.slice(0, -1).every(ms => ms > 0 && ms <= 5000));
  assert.ok(delays.at(-1) >= 12000);
});

test('deadline abort tells requester a charge may still occur', async () => {
  const controller = new AbortController();
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => json({ task_id: 'task' }), async () => {
    controller.abort(); throw new Error('aborted');
  });
  await assert.rejects(provider.analyze(text, { signal: controller.signal }), e => e.code === 'timeout' && /charge/.test(e.message));
});

test('interrupted poll body retries GET without resubmitting paid work', async () => {
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error('transport interrupted')); } }));
  const replies = [json({ task_id: 'task' }), broken, json(pangram())];
  const methods = [];
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async (_url, options) => {
    methods.push(options.method); return replies.shift();
  }, async () => {});
  await provider.analyze(text, { signal: new AbortController().signal });
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});

test('missing Pangram version remains unspecified', () => {
  const body = pangram(); delete body.version;
  assert.equal(normalizePangram(body, 'pangram-4').version, undefined);
});

for (const task of [{}, { task_id: '' }]) {
  test(`Pangram rejects invalid submission receipt ${JSON.stringify(task)}`, async () => {
    const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => json(task));
    await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), { code: 'response' });
  });
}

for (const stage of [undefined, 'unexpected']) {
  test(`Pangram rejects unknown poll stage ${String(stage)}`, async () => {
    const replies = [json({ task_id: 'task' }), json({ stage })];
    const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => replies.shift(), async () => {});
    await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), { code: 'response' });
  });
}

test('a polling rejection does not imply that the paid submission was rejected', async () => {
  const { ScanRejected } = require('../dist/aiDetection/types');
  const replies = [json({ task_id: 'task' }), new Response(null, { status: 401 })];
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => replies.shift(), async () => {});
  await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), e => e.code === 'http_401' && !(e instanceof ScanRejected));
});

test('Pangram rejects a non-object JSON response', async () => {
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => json(null));
  await assert.rejects(provider.analyze(text, { signal: new AbortController().signal }), { code: 'response' });
});

for (const retryAfter of ['invalid-date', new Date(30_000).toUTCString()]) {
  test(`Pangram handles Retry-After ${retryAfter}`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const replies = [json({ task_id: 'task' }), json({}, 429, { 'Retry-After': retryAfter }), json(pangram())];
    const delays = [];
    const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05, async () => replies.shift(), async ms => { delays.push(ms); });
    await provider.analyze(text, { signal: new AbortController().signal });
    assert.ok(Number.isFinite(delays[1]) && delays[1] > 0);
    if (retryAfter !== 'invalid-date') assert.ok(delays[1] >= 30_000);
  });
}

test('default poll wait is cancellable', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { controller.abort(); return json({ task_id: 'task' }); });
  const provider = new PangramProvider('TEST', 'pangram-4', 'fixture-v1', .05);
  await assert.rejects(provider.analyze(text, { signal: controller.signal }), { code: 'timeout' });
});
