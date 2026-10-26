const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GPTZeroProvider, normalizeGPTZero } = require('../dist/aiDetection/GPTZeroProvider');
const { summaryEmbed, fullReport, segmentChart, budgetText } = require('../dist/aiDetection/report');
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
const signal = () => new AbortController().signal;
const session = result => ({ id: 'fixture', result, submittedText: source, completedAt: 1000, expiresAt: 2000, hasChart: true });

test('GPTZero preserves document probabilities, qualifications, masking and exact repeated-sentence positions', () => {
  const r = normalizeGPTZero(response(), source);
  assert.equal(r.textFractions, undefined);
  assert.deepEqual(r.documentProbabilities, { ai: .1, mixed: .7, human: .2 });
  assert.match(r.headline, /low confidence/); assert.match(r.explanation, /Short text/);
  assert.deepEqual(r.segments.map(s => s.category), ['ai', 'unknown', 'unknown']);
  assert.match(r.segments[1].label, /not a human classification/);
  assert.match(r.segments[2].label, /Excluded/); assert.equal(r.segments[2].confidence, undefined);
  for (const s of r.segments) assert.equal(source.slice(s.range.start, s.range.end), s.text);
  assert.ok(r.segments[1].range.end < r.segments[2].range.end);
  const summary = summaryEmbed(session(r));
  assert.match(summary.fields[0].value, /unavailable/);
  assert.match(summary.fields[1].value, /Mixed: 70.0%/);
  assert.match(summary.fields[1].value, /not percentages of text/);
  assert.match(fullReport(session(r)).toString(), /not percentages of text/);
  assert.equal(segmentChart(r).subarray(1, 4).toString(), 'PNG');
});

test('GPTZero uncertain classifications and unalignable segments remain qualified instead of fabricated', () => {
  const body = response(); body.documents[0].confidence_category = 'reject';
  body.documents[0].sentences[0].sentence = 'Changed text';
  const r = normalizeGPTZero(body, source);
  assert.equal(r.headline, 'Uncertain classification');
  assert.ok(r.segments.every(s => s.range === undefined)); assert.equal(segmentChart(r), undefined);
  assert.equal(r.segments[0].text, 'Changed text');
  const empty = response(); delete empty.documents[0].sentences;
  assert.deepEqual(normalizeGPTZero(empty, source).segments, []);
  const unicode = response(); unicode.documents[0].sentences = [{ sentence: '🙂 Café.', highlight_sentence_for_ai: true }];
  assert.deepEqual(normalizeGPTZero(unicode, '🙂 Café.').segments[0].range, { start: 0, end: 8 });
  const skipped = response(); skipped.documents[0].sentences.shift();
  assert.ok(normalizeGPTZero(skipped, source).segments.every(s => !s.range));
});

test('GPTZero rejects malformed probabilities, documents and segment fields', () => {
  for (const mutate of [
    b => { b.documents = []; }, b => { b.documents.push(b.documents[0]); },
    b => { b.documents[0].predicted_class = 'new-class'; },
    b => { b.documents[0].class_probabilities.ai = 2; },
    b => { b.documents[0].class_probabilities.mixed = .1; },
    b => { delete b.documents[0].class_probabilities; },
    b => { b.documents[0].sentences[0].generated_prob = -1; },
    b => { b.documents[0].sentences[0].should_mask = 'false'; },
    b => { b.documents[0].sentences[0].highlight_sentence_for_ai = 'false'; },
    b => { b.documents[0].inputText = ''; },
    b => { b.documents[0].sentences = {}; },
  ]) {
    const body = response(); mutate(body);
    assert.throws(() => normalizeGPTZero(body, source), { code: 'response' });
  }
});

test('GPTZero submits once using documented authentication and gets observed remaining words separately', async () => {
  const requests = [];
  const provider = new GPTZeroProvider('SYNTHETIC_KEY', 'fixture-model', .5, async (url, options) => {
    requests.push({ url, ...options });
    return options.method === 'POST' ? json(response()) : json({ data: { words_left: 4321 } });
  });
  const r = await provider.analyze(source, { signal: signal() });
  assert.deepEqual(requests.map(r => [r.method, r.url]), [
    ['POST', 'https://api.gptzero.me/v2/predict/text'], ['GET', 'https://api.gptzero.me/v3/usage-stats'],
  ]);
  assert.equal(requests[0].headers['x-api-key'], 'SYNTHETIC_KEY');
  assert.equal(requests[0].redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].body), { document: source, modelVersion: 'fixture-model' });
  assert.equal(requests[1].body, undefined);
  assert.equal(r.usage.estimated, true); assert.equal(r.usage.cost.amount, r.usage.units / 1000 * .5);
  assert.equal(r.balance.amount, 4321); assert.match(r.balance.unit, /words/); assert.ok(r.balance.observedAt > 0);
});

test('GPTZero balance failure or null quota preserves the scan and never fabricates cost or zero balance', async () => {
  for (const balance of [null, -1, '500', undefined, new Error('SECRET'), 0]) {
    let calls = 0;
    const provider = new GPTZeroProvider('SYNTHETIC', undefined, undefined, async (_url, options) => {
      calls++;
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), { document: source });
        return json(response());
      }
      if (balance instanceof Error) throw balance;
      return json({ data: { words_left: balance } });
    });
    const r = await provider.analyze(source, { signal: signal() });
    assert.equal(calls, 2); assert.equal(r.usage.cost, undefined);
    assert.equal(r.balance?.amount, balance === 0 ? 0 : undefined);
    assert.match(budgetText(r), /cost unavailable/);
  }
});

test('GPTZero never retries billed POST on HTTP, malformed, transport or aborted outcomes', async () => {
  for (const outcome of [400, 401, 403, 429, 500, 'invalid-json', 'oversize', new Error('SECRET')]) {
    let calls = 0;
    const provider = new GPTZeroProvider('SYNTHETIC', undefined, undefined, async () => {
      calls++;
      if (outcome instanceof Error) throw outcome;
      if (outcome === 'invalid-json') return new Response('SECRET');
      if (outcome === 'oversize') return new Response('x'.repeat(4 * 1024 * 1024 + 1));
      return new Response('SECRET', { status: outcome });
    });
    await assert.rejects(provider.analyze(source, { signal: signal() }), error => !error.message.includes('SECRET'));
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const provider = new GPTZeroProvider('SYNTHETIC', undefined, undefined, async (_url, options) => {
    calls++; options.signal.throwIfAborted();
  });
  await assert.rejects(provider.analyze(source, { signal: controller.signal }), /may incur a charge/);
  assert.equal(calls, 1);
});
