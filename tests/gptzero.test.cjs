const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GPTZeroProvider, normalizeGPTZero } = require('../dist/aiDetection/GPTZeroProvider');
const { ScanRejected } = require('../dist/aiDetection/types');
const { json } = require('./fixtures.cjs');
const source = 'A synthetic opening.\n\nA second sentence. A second sentence.';
const response = () => ({ version: 'fixture-version', documents: [{
  predicted_class: 'mixed', confidence_category: 'low', class_probabilities: { ai: .1, mixed: .7, human: .2 },
  result_message: 'Synthetic uncertain result.', result_sub_message: 'Short text needs care.',
  sentences: [
    { sentence: 'A synthetic opening.', generated_prob: .9, highlight_sentence_for_ai: true },
    { sentence: 'A second sentence.', generated_prob: .8, highlight_sentence_for_ai: false },
    { sentence: 'A second sentence.', generated_prob: 0, highlight_sentence_for_ai: true, should_mask: true },
  ],
}] });
const normalize = (body = response(), text = source) => normalizeGPTZero(body, text, 'fixture-model');
const signal = () => new AbortController().signal;
const detector = fetcher => new GPTZeroProvider('SYNTHETIC', 'fixture-model', undefined, fetcher);

test('GPTZero preserves document probabilities without inventing text fractions', () => {
  const r = normalize();
  assert.deepEqual(r.documentProbabilities, { ai: .1, mixed: .7, human: .2 });
  assert.equal(r.textFractions, undefined);
});
test('GPTZero preserves low confidence and short-text qualifications', () => {
  const r = normalize(); assert.match(r.headline, /low confidence/); assert.match(r.explanation, /Short text/);
});
test('unhighlighted sentences are not classified as human', () => {
  const segment = normalize().segments[1]; assert.equal(segment.category, 'unknown');
  assert.match(segment.label, /not a human classification/);
});
test('masked sentences omit AI confidence', () => {
  const segment = normalize().segments[2]; assert.equal(segment.category, 'unknown');
  assert.match(segment.label, /Excluded/); assert.equal(segment.confidence, undefined);
});
test('repeated sentences align in their original order', () => {
  const segments = normalize().segments;
  assert.ok(segments[1].range.end < segments[2].range.end);
  for (const s of segments) assert.equal(source.slice(s.range.start, s.range.end), s.text);
});
test('rejected classifications remain uncertain', () => {
  const body = response(); body.documents[0].confidence_category = 'reject';
  assert.equal(normalize(body).headline, 'Uncertain classification');
});
test('changed sentences omit unverified positions', () => {
  const body = response(); body.documents[0].sentences[0].sentence = 'Changed text';
  assert.ok(normalize(body).segments.every(s => !s.range));
});
test('skipped sentences cannot shift highlights to later occurrences', () => {
  const body = response(); body.documents[0].sentences.shift();
  assert.ok(normalize(body).segments.every(s => !s.range));
});
test('unclassified trailing text invalidates positions', () => {
  assert.ok(normalize(response(), source + ' missing').segments.every(s => !s.range));
});
test('absent sentences produce an empty segment list', () => {
  const body = response(); delete body.documents[0].sentences;
  assert.deepEqual(normalize(body).segments, []);
});
test('Unicode sentence positions use JavaScript string offsets', () => {
  const body = response(); body.documents[0].sentences = [{ sentence: '🙂 Café.', highlight_sentence_for_ai: true }];
  assert.deepEqual(normalize(body, '🙂 Café.').segments[0].range, { start: 0, end: 8 });
});
test('document-level version takes precedence over response version', () => {
  const body = response(); body.documents[0].version = 'document-version';
  assert.equal(normalize(body).version, 'document-version');
});
test('missing optional metadata remains unspecified', () => {
  const body = response(); delete body.version;
  for (const key of ['confidence_category', 'result_message', 'result_sub_message']) delete body.documents[0][key];
  const r = normalize(body); assert.equal(r.version, undefined); assert.match(r.headline, /unavailable confidence/);
});
test('provider-normalized input is used for sentence alignment', () => {
  const body = response(); body.documents[0].inputText = source;
  assert.equal(normalize(body, 'other').analyzedText, source);
});
for (const [name, mutate] of [
  ['empty documents', b => { b.documents = []; }], ['multiple documents', b => { b.documents.push(b.documents[0]); }],
  ['missing documents', b => { delete b.documents; }], ['null document', b => { b.documents[0] = null; }],
  ['unknown class', b => { b.documents[0].predicted_class = 'new-class'; }],
  ['AI probability outside range', b => { b.documents[0].class_probabilities.ai = 2; }],
  ['invalid mixed probability', b => { b.documents[0].class_probabilities.mixed = '0.7'; }],
  ['invalid human probability', b => { b.documents[0].class_probabilities.human = -1; }],
  ['fractions do not sum to one', b => { b.documents[0].class_probabilities.mixed = .1; }],
  ['missing probabilities', b => { delete b.documents[0].class_probabilities; }],
  ['invalid sentence probability', b => { b.documents[0].sentences[0].generated_prob = -1; }],
  ['invalid mask', b => { b.documents[0].sentences[0].should_mask = 'false'; }],
  ['invalid highlight', b => { b.documents[0].sentences[0].highlight_sentence_for_ai = 'false'; }],
  ['empty normalized text', b => { b.documents[0].inputText = ''; }],
  ['non-string normalized text', b => { b.documents[0].inputText = 1; }],
  ['oversize normalized text', b => { b.documents[0].inputText = 'x'.repeat(262_145); }],
  ['non-array sentences', b => { b.documents[0].sentences = {}; }],
  ['null sentence', b => { b.documents[0].sentences[0] = null; }],
  ['empty sentence', b => { b.documents[0].sentences[0].sentence = ' '; }],
  ['non-string sentence', b => { b.documents[0].sentences[0].sentence = false; }],
]) {
  test(`GPTZero rejects ${name}`, () => {
    const body = response(); mutate(body); assert.throws(() => normalize(body), { code: 'response' });
  });
}
for (const value of [null, [], false]) test(`GPTZero rejects top-level ${JSON.stringify(value)}`, () => assert.throws(() => normalize(value), { code: 'response' }));

test('GPTZero submits once with its configured model and API authentication', async () => {
  const requests = [];
  await detector(async (url, options) => { requests.push({ url, ...options }); return options.method === 'POST' ? json(response()) : json({}); }).analyze(source, { signal: signal() });
  const post = requests.filter(r => r.method === 'POST');
  assert.equal(post.length, 1); assert.equal(post[0].url, 'https://api.gptzero.me/v2/predict/text');
  assert.equal(post[0].headers['x-api-key'], 'SYNTHETIC'); assert.equal(post[0].redirect, 'error');
  assert.deepEqual(JSON.parse(post[0].body), { document: source, modelVersion: 'fixture-model' });
});
test('GPTZero estimates cost using the configured word rate', async () => {
  const provider = new GPTZeroProvider('SYNTHETIC', 'fixture-model', .5, async (_url, options) => options.method === 'POST' ? json(response()) : json({}));
  const r = await provider.analyze(source, { signal: signal() });
  assert.equal(r.usage.cost.amount, r.usage.units / 1000 * .5); assert.equal(r.usage.estimated, true);
});
for (const balance of [null, -1, '500', undefined, 0, 4321]) {
  test(`GPTZero handles balance ${String(balance)} without inventing credit`, async () => {
    const r = await detector(async (_url, options) => options.method === 'POST' ? json(response()) : json({ data: { words_left: balance } })).analyze(source, { signal: signal() });
    assert.equal(r.balance?.amount, typeof balance === 'number' && balance >= 0 ? balance : undefined);
    assert.equal(r.usage.cost, undefined);
  });
}
for (const [name, outcome] of [['null', () => json(null)], ['no data', () => json({})], ['transport failure', () => { throw new Error('SECRET'); }], ['HTTP failure', () => new Response(null, { status: 401 })]]) {
  test(`balance ${name} preserves the paid result`, async () => {
    const r = await detector(async (_url, options) => options.method === 'POST' ? json(response()) : outcome()).analyze(source, { signal: signal() });
    assert.equal(r.provider, 'GPTZero'); assert.equal(r.balance, undefined);
  });
}
for (const status of [400, 401, 403, 429, 500]) {
  test(`GPTZero does not retry HTTP ${status} submissions`, async t => {
    const fetch = t.mock.fn(async () => new Response(null, { status }));
    await assert.rejects(detector(fetch).analyze(source, { signal: signal() }), e => e.code === `http_${status}` && (e instanceof ScanRejected) === (status < 500));
    assert.equal(fetch.mock.callCount(), 1);
  });
}
for (const [name, outcome] of [
  ['malformed JSON', () => new Response('SECRET')], ['oversized body', () => new Response('x'.repeat(4 * 1024 * 1024 + 1))],
  ['transport failure', () => { throw new Error('SECRET'); }], ['invalid UTF-8', () => new Response(new Uint8Array([0xff]))],
]) {
  test(`GPTZero does not retry ${name}`, async t => {
    const fetch = t.mock.fn(async () => outcome());
    await assert.rejects(detector(fetch).analyze(source, { signal: signal() }), e => !e.message.includes('SECRET'));
    assert.equal(fetch.mock.callCount(), 1);
  });
}
test('GPTZero uses the default fetch dependency', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => options.method === 'POST' ? json(response()) : json({}));
  assert.equal((await detector().analyze(source, { signal: signal() })).provider, 'GPTZero');
});

test('HTTP error bodies are discarded without parsing submitted text', async () => {
  await assert.rejects(detector(async () => new Response('SECRET', { status: 401 })).analyze(source, { signal: signal() }), e => e.code === 'http_401' && !e.message.includes('SECRET'));
});
