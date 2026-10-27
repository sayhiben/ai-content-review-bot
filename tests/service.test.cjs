const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AiCheckService, PublishRejected } = require('../dist/aiDetection/AiCheckService');
const { text, result, context, provider, deferred } = require('./fixtures.cjs');
const setup = (t, providers) => {
  let now = 1_000_000;
  const scan = t.mock.fn(async source => result(source));
  const log = t.mock.fn();
  const service = new AiCheckService(providers ?? { fixture: provider({ analyze: scan }) }, () => now, log);
  t.after(() => service.dispose());
  const ready = async (id = 'scan', owner = context, source = text, providerId) => {
    const session = service.create(owner, id);
    await service.analyze(session, async () => source, now, providerId);
    return session;
  };
  return { service, scan, log, ready, now: () => now, tick: ms => { now += ms; } };
};

test('shutdown cancels an active scan', async t => {
  const started = deferred();
  const s = setup(t, { fixture: provider({ analyze: async (_text, { signal }) => {
    started.resolve();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } }) });
  const scan = s.ready(); await started.promise; s.service.dispose();
  await assert.rejects(scan, { code: 'analysis' });
});
test('shutdown rejects new requests', t => {
  const s = setup(t); s.service.dispose();
  assert.throws(() => s.service.create(context, 'new'), { code: 'shutdown' });
});
test('duplicate interactions are rejected', t => {
  const s = setup(t); s.service.create(context, 'same');
  assert.throws(() => s.service.create(context, 'same'), { code: 'duplicate' });
});
for (const key of ['userId', 'guildId', 'channelId']) {
  test(`controls bind ${key}`, t => {
    const s = setup(t), session = s.service.create(context, 'input');
    assert.throws(() => s.service.get(session.id, { ...context, [key]: 'other' }), { code: 'owner' });
  });
}
test('invalid input is rejected before calling a provider', async t => {
  const s = setup(t);
  await assert.rejects(s.ready('short', context, 'tiny'), { code: 'short' });
  assert.equal(s.scan.mock.callCount(), 0);
});
test('invalid input does not consume the cooldown', async t => {
  const s = setup(t); await assert.rejects(s.ready('short', context, 'tiny'));
  await s.ready('valid'); assert.equal(s.scan.mock.callCount(), 1);
});
test('a completed interaction cannot be analyzed twice', async t => {
  const s = setup(t), session = await s.ready();
  await assert.rejects(s.service.analyze(session, async () => text, s.now()), { code: 'duplicate' });
});
test('cooldown blocks another submission by the same user', async t => {
  const s = setup(t); await s.ready();
  await assert.rejects(s.ready('second'), { code: 'cooldown' });
});
test('cached results replay after the cooldown without a provider call', async t => {
  const s = setup(t); await s.ready(); s.tick(60_000);
  const replay = await s.ready('replay', context, ` \r\n${text} \n`);
  assert.equal(s.scan.mock.callCount(), 1); assert.equal(replay.cached, true);
  assert.equal(s.log.mock.calls.at(-1).arguments[0], 'cache_hit');
});
test('one user cannot run simultaneous scans', async t => {
  const gate = deferred(); const s = setup(t, { fixture: provider({ analyze: () => gate.promise }) });
  const first = s.ready(); await assert.rejects(s.ready('other'), { code: 'active' });
  gate.resolve(result()); await first;
});
test('two concurrent submissions occupy the global capacity', async t => {
  const gate = deferred(); const s = setup(t, { fixture: provider({ analyze: () => gate.promise }) });
  const first = s.ready(); const second = s.ready('second', { ...context, userId: 'second' }, text + ' extra');
  await assert.rejects(s.ready('third', { ...context, userId: 'third' }), { code: 'busy' });
  gate.resolve(result()); await Promise.all([first, second]);
});
test('provider failures release the capacity reservation', async t => {
  const s = setup(t, { fixture: provider({ analyze: async () => { throw new Error('SECRET'); } }) });
  await assert.rejects(s.ready(), e => e.code === 'analysis' && !e.message.includes('SECRET'));
  await assert.rejects(s.ready('another', { ...context, userId: 'other' }, 'tiny'), { code: 'short' });
});
test('cancelled input forms expire', t => {
  const s = setup(t), session = s.service.create(context, 'input'); s.tick(600_001);
  assert.throws(() => s.service.get(session.id, context), { code: 'expired' });
});
test('controls expire before the interaction token deadline', async t => {
  const s = setup(t), session = s.service.create(context, 'input');
  const createdAt = s.now() - 5 * 60_000;
  await s.service.analyze(session, async () => text, createdAt);
  assert.equal(session.expiresAt, createdAt + 14 * 60_000);
});
test('periodic cleanup expires abandoned sessions', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const s = setup(t), session = s.service.create(context, 'input'); s.tick(600_001);
  t.mock.timers.tick(30_000);
  assert.throws(() => s.service.get(session.id, context), { code: 'expired' });
});
test('old input sessions are evicted at capacity', t => {
  const s = setup(t), first = s.service.create(context, 'first');
  for (let n = 0; n < 100; n++) s.service.create(context, `next-${n}`);
  assert.throws(() => s.service.get(first.id, context), { code: 'expired' });
});
test('interaction deduplication remains bounded', t => {
  const s = setup(t);
  for (let n = 0; n < 2000; n++) s.service.create(context, String(n));
  assert.throws(() => s.service.create(context, 'overflow'), { code: 'busy' });
  s.tick(15 * 60_000); assert.ok(s.service.create(context, 'overflow'));
});
test('sessions being published are not evicted', async t => {
  const s = setup(t), gate = deferred(), pending = [];
  for (let n = 0; n < 100; n++) {
    const session = await s.ready(String(n), { ...context, userId: String(n) });
    pending.push(s.service.publish(session, () => gate.promise));
  }
  assert.throws(() => s.service.create(context, 'overflow'), { code: 'busy' });
  s.tick(600_001);
  assert.throws(() => s.service.create(context, 'still-full'), { code: 'busy' });
  gate.resolve({ id: 'public', url: 'https://discord.com/fixture' }); await Promise.all(pending);
});
test('expired sessions cannot start an analysis', async t => {
  const s = setup(t), session = s.service.create(context, 'input'); s.tick(600_001);
  await assert.rejects(s.service.analyze(session, async () => text, s.now()), { code: 'expired' });
});
test('expired sessions cannot be published', async t => {
  const s = setup(t), session = await s.ready(); s.tick(600_001);
  await assert.rejects(s.service.publish(session, async () => assert.fail('must not publish')), { code: 'expired' });
});
test('unfinished sessions cannot be published', async t => {
  const s = setup(t), session = s.service.create(context, 'input');
  await assert.rejects(s.service.publish(session, async () => assert.fail('must not publish')), { code: 'pending' });
});
test('sharing locks simultaneous button clicks', async t => {
  const s = setup(t), session = await s.ready(), gate = deferred();
  const first = s.service.publish(session, () => gate.promise);
  await assert.rejects(s.service.publish(session, async () => assert.fail('must not duplicate')), { code: 'sharing' });
  gate.resolve({ id: 'public', url: 'https://discord.com/fixture' }); await first;
});
test('successful sharing remembers the public message', async t => {
  const s = setup(t), session = await s.ready(), send = t.mock.fn(async () => ({ id: 'public', url: 'https://discord.com/fixture' }));
  await s.service.publish(session, send); await s.service.publish(session, send);
  assert.equal(send.mock.callCount(), 1);
});
test('definite publish rejection permits retry', async t => {
  const s = setup(t), session = await s.ready();
  await assert.rejects(s.service.publish(session, async () => { throw new PublishRejected(); }), { code: 'publish_rejected' });
  const message = await s.service.publish(session, async () => ({ id: 'public' }));
  assert.equal(message.id, 'public');
});
test('ambiguous publish failure locks subsequent attempts', async t => {
  const s = setup(t), session = await s.ready();
  await assert.rejects(s.service.publish(session, async () => { throw new Error('SECRET'); }), { code: 'share_unknown' });
  await assert.rejects(s.service.publish(session, async () => assert.fail('must not send')), { code: 'share_unknown' });
});
const twoProviders = () => ({ first: provider(), second: provider() });
for (const id of [undefined, 'constructor', '__proto__']) {
  test(`unavailable provider ${String(id)} is rejected`, async t => {
    const s = setup(t, twoProviders()); await assert.rejects(s.ready('input', context, text, id), { code: 'provider' });
  });
}
test('a single-provider session cannot switch providers', async t => {
  const s = setup(t); await assert.rejects(s.ready('input', context, text, 'other'), { code: 'provider' });
});
test('provider selection cannot bypass the user cooldown', async t => {
  const s = setup(t, twoProviders()); await s.ready('first', context, text, 'first');
  await assert.rejects(s.ready('second', context, text, 'second'), { code: 'cooldown' });
});
test('a failed provider does not fall back to another provider', async t => {
  const other = t.mock.fn();
  const s = setup(t, { first: provider({ analyze: async () => { throw new Error('failure'); } }), second: provider({ analyze: other }) });
  await assert.rejects(s.ready('input', context, text, 'first'));
  assert.equal(other.mock.callCount(), 0);
});
test('provider character limit is enforced before submission', async t => {
  const s = setup(t, { limited: provider({ minimumWords: 1, maximumCharacters: 20 }) });
  await assert.rejects(s.ready('long', context, 'x'.repeat(21)), { code: 'long' });
  assert.equal((await s.ready('valid', context, 'Short valid text')).phase, 'ready');
});
test('no available providers fails clearly', () => assert.throws(() => new AiCheckService({}), { code: 'unavailable' }));
test('default clock and logger support a completed scan', async t => {
  const service = new AiCheckService({ fixture: provider() }); t.after(() => service.dispose());
  const session = service.create(context, 'input');
  await service.analyze(session, async () => text, Date.now());
  assert.equal(session.phase, 'ready');
});
