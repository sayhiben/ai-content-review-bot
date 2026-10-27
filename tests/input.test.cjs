const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wordCount, validateText, readTextAttachment, readLimited } = require('../dist/aiDetection/input');
const { text } = require('./fixtures.cjs');
const { LIMITS } = require('../dist/aiDetection/types');
const signal = () => new AbortController().signal;
const attachment = { name: 'comment.txt', size: 100, url: 'https://cdn.discordapp.com/attachments/fixture.txt' };

test('word count supports Unicode and excludes emoji', () => assert.equal(wordCount('Café 🙂 garden'), 2));
for (const count of [50, LIMITS.words]) {
  test(`input permits the ${count}-word boundary`, () => assert.doesNotThrow(() => validateText('word '.repeat(count), 50)));
}
for (const [name, source, code] of [
  ['too short', 'word '.repeat(49), 'short'], ['too long', 'word '.repeat(LIMITS.words + 1), 'long'],
  ['empty', ' \n\t', 'empty'], ['binary', text + '\0', 'binary'], ['oversized', 'x'.repeat(LIMITS.bytes + 1), 'size'],
]) test(`${name} input is rejected`, () => assert.throws(() => validateText(source, 50), { code }));

test('UTF-8 decoding removes BOM but preserves the remaining attachment text', async () => {
  const original = '\ufeff# Markdown\r\n\n  ' + text;
  assert.equal(await readTextAttachment(attachment, signal(), async () => new Response(original)), original.slice(1));
});
test('attachment download forbids redirects', async t => {
  const fetch = t.mock.fn(async () => new Response(text)); await readTextAttachment(attachment, signal(), fetch);
  assert.equal(fetch.mock.calls[0].arguments[1].redirect, 'error');
});
for (const [name, change] of [
  ['non-text format', { name: 'report.pdf' }], ['no name', { name: null }], ['declared size', { size: LIMITS.bytes + 1 }],
  ['HTTP URL', { url: 'http://cdn.discordapp.com/x' }], ['external host', { url: 'https://example.invalid/x' }],
]) {
  test(`attachment ${name} fails before download`, async () => {
    await assert.rejects(readTextAttachment({ ...attachment, ...change }, signal(), async () => assert.fail('must not download')), { code: 'file' });
  });
}
test('attachment size is checked against actual bytes', async () => {
  await assert.rejects(readTextAttachment(attachment, signal(), async () => new Response('x'.repeat(LIMITS.bytes + 1))), { code: 'size' });
});
test('invalid UTF-8 is rejected', async () => {
  await assert.rejects(readTextAttachment(attachment, signal(), async () => new Response(new Uint8Array([0xc3, 0x28]))), { code: 'file' });
});
test('response limits apply across streamed chunks', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from('123')); c.enqueue(Buffer.from('456')); c.close(); } });
  await assert.rejects(readLimited(new Response(stream), 4), { code: 'size' });
});
test('empty response bodies are rejected', async () => {
  await assert.rejects(readLimited(new Response(null), 100), { code: 'response' });
});
test('attachment HTTP failure has a safe user-facing error', async () => {
  await assert.rejects(readTextAttachment(attachment, signal(), async () => new Response(null, { status: 404 })), { code: 'file' });
});
test('test harness refuses fetch connections', () => assert.throws(() => globalThis.fetch('https://example.invalid'), /forbidden/));
test('test harness refuses socket connections', () => assert.throws(() => require('node:net').connect(443, 'example.invalid'), /forbidden/));
