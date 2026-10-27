const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summaryEmbed, segmentPages, fullReport, segmentChart, reportFiles, budgetText } = require('../dist/aiDetection/report');
const { result, text, context } = require('./fixtures.cjs');
const session = (r = result(), overrides = {}) => ({ ...context, id: '123', result: r, submittedText: text, scannedAt: 1_000_000, completedAt: 1_000_000, expiresAt: 1_600_000, ...overrides });
const field = (embed, name) => embed.fields.find(f => f.name === name)?.value;

test('missing scores remain unavailable', () => {
  const r = result(); delete r.textFractions;
  assert.equal(field(summaryEmbed(session(r)), 'Score'), 'Unavailable');
});
test('document probabilities are distinguished from text percentages', () => {
  const r = result(); delete r.textFractions;
  r.documentProbabilities = { ai: .1, mixed: .7, human: .2 };
  assert.match(field(summaryEmbed(session(r)), 'Document probabilities'), /Mixed: 70.0%.*\nProbabilities, not text percentages/);
});
test('small nonzero text fractions stay visible', () => {
  const r = result(); r.textFractions.ai = .0002;
  assert.match(field(summaryEmbed(session(r)), 'Text classified as'), /<0.1%/);
});
test('missing fraction is not represented as zero', () => {
  const r = result(); delete r.textFractions.assisted;
  assert.match(field(summaryEmbed(session(r)), 'Text classified as'), /Assisted: \*\*Unavailable/);
});
test('balances include their unit and observation date', () => {
  const r = result(); r.balance = { amount: 12.5, unit: 'USD', observedAt: 0 };
  assert.match(budgetText(r), /12.5 USD as of 1970-01-01T00:00:00.000Z/);
});
for (const [name, amount, expected] of [['small', .001, '<0.01 USD'], ['whole', 2, '2.00 USD'], ['zero', 0, '0.00 USD']]) {
  test(`${name} cost is displayed accurately`, () => {
    const r = result(); r.usage = { estimated: true, units: 100, unit: 'words', cost: { amount, currency: 'USD' } };
    assert.ok(budgetText(r).includes(expected));
  });
}
test('reported usage is distinguished from estimates', () => {
  const r = result(); r.usage = { estimated: false, units: 100, unit: 'words' };
  assert.match(budgetText(r), /Reported: 100 words · cost unavailable/);
});
test('cached results disclose no new charge', () => {
  assert.match(field(summaryEmbed(session(result(), { cached: true })), 'API budget'), /Cached result · no new scan charge/);
});
test('reports display the original scan date', () => {
  assert.equal(summaryEmbed(session(result(), { completedAt: 2_000_000 })).timestamp, new Date(1_000_000).toISOString());
});
test('model and reported version appear in the summary', () => {
  const r = result(); r.version = 'v2';
  assert.match(summaryEmbed(session(r)).description, /fixture · v2/);
});
test('segment pages respect Discord limits after escaping', () => {
  const pages = segmentPages(result('**@everyone** 🙂\n'.repeat(1000)));
  assert.ok(pages.length > 1);
  assert.ok(pages.every(p => p.length <= 4096 && !p.includes('@everyone')));
});
test('full attachment preserves the submitted text', () => {
  const source = '**@everyone** 🙂\n'.repeat(1000);
  assert.ok(fullReport(session(result(source), { submittedText: source })).toString().includes(source));
});
test('full text includes the provider explanation and segment confidence', () => {
  const complete = fullReport(session()).toString();
  assert.match(complete, /Uncertain fixture result/);
  assert.match(complete, /Confidence: Low/);
});
test('provider-normalized text is included separately', () => {
  assert.match(fullReport(session(result('Provider normalized text'))).toString(), /ANALYZED TEXT\nProvider normalized text/);
});
test('full report includes document probabilities without invented fractions', () => {
  const r = result(); delete r.textFractions;
  r.documentProbabilities = { ai: .1, mixed: .7, human: .2 }; r.version = 'v2';
  assert.match(fullReport(session(r)).toString(), /Mixed: 70.0%/);
});
test('segments without confidence remain usable', () => {
  const r = result(); delete r.segments[0].confidence;
  assert.doesNotMatch(segmentPages(r)[0], /Confidence/);
  assert.ok(fullReport(session(r)).toString().includes(text));
});
test('empty segment text has a readable placeholder', () => {
  const r = result(); r.segments[0].text = '';
  assert.match(segmentPages(r)[0], /Empty segment/);
});
test('missing segments are disclosed in each format', () => {
  const r = result(); r.segments = [];
  assert.match(field(summaryEmbed(session(r)), 'Segments'), /No segment/);
  assert.match(segmentPages(r)[0], /No segment/);
  assert.match(fullReport(session(r)).toString(), /Segment details unavailable/);
  assert.equal(segmentChart(r), undefined);
});
test('unverified positions omit the chart', () => {
  const r = result(); delete r.segments[0].range;
  assert.equal(segmentChart(r), undefined);
  assert.match(field(summaryEmbed(session(r)), 'Segments'), /Chart unavailable/);
});
test('rendering failure is disclosed in the summary', () => {
  assert.match(field(summaryEmbed(session(result(), { hasChart: false })), 'Segments'), /Chart unavailable/);
});
test('chart produces a PNG attachment', () => {
  const file = reportFiles(session()).find(f => f.name === 'ai-segments.png');
  assert.equal(file.attachment.subarray(1, 4).toString(), 'PNG');
});
test('unknown categories get an additional chart lane', () => {
  const r = result(); r.segments[0].category = 'unknown';
  assert.ok(segmentChart(r).readUInt32BE(20) > segmentChart(result()).readUInt32BE(20));
});
for (const [name, chart] of [['no chart', () => undefined], ['canvas failure', () => { throw new Error('canvas failed'); }]]) {
  test(`${name} still delivers the full text`, () => {
    const files = reportFiles(session(), chart);
    assert.deepEqual(files.map(f => f.name), ['ai-report.txt']);
    assert.ok(files[0].attachment.toString().includes(text));
  });
}
test('summary respects individual and aggregate Discord limits', () => {
  const r = result(); r.provider = '*'.repeat(10_000); r.model = '@everyone'.repeat(5000);
  r.documentProbabilities = { ai: .1, mixed: .7, human: .2 };
  const e = summaryEmbed(session(r));
  assert.ok(e.title.length <= 256 && e.description.length <= 4096);
  assert.ok(e.fields.every(f => f.value.length <= 1024));
  assert.ok(e.title.length + e.description.length + e.footer.text.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0) <= 6000);
});
