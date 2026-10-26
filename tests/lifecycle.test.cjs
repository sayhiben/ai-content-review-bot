const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events, GatewayIntentBits, MessageFlags, GuildMemberManager, MessageManager } = require('discord.js');
const { createBot } = require('../dist/bot');
const { config } = require('./fixtures.cjs');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const interaction = () => ({ commandName: 'ai-check', isChatInputCommand: () => true, isRepliable: () => true });

function fakeClient(available = true) {
  const client = new EventEmitter();
  client.guilds = { cache: new Map([['guild', { available }]]) };
  client.isReady = () => true;
  client.destroy = async () => {};
  return client;
}

test('client uses only the unprivileged Guilds intent and suppresses mentions by default', async () => {
  const bot = createBot(config(), { health: () => {}, clearHealth: () => {}, log: () => {} });
  assert.equal(bot.client.options.intents.bitfield, GatewayIntentBits.Guilds);
  assert.deepEqual(bot.client.options.allowedMentions.parse, []);
  await bot.stop();
});

test('shutdown drains accepted work, rejects new work privately, and destroys once', async () => {
  const client = fakeClient(); let logins = 0, destroyed = 0, disposed = 0, accepted = 0, finish;
  client.login = async token => { assert.equal(token, 'TEST_ONLY'); logins++; };
  client.isReady = () => true; client.destroy = async () => { destroyed++; };
  const states = [];
  const bot = createBot(config(), { client, health: ready => states.push(ready), clearHealth: () => {}, log: () => {},
    feature: { handleInteraction: async () => { accepted++; await new Promise(resolve => { finish = resolve; }); }, dispose: () => { disposed++; } },
  });
  assert.equal(logins, 0);
  await bot.login(); assert.equal(logins, 1);
  client.emit(Events.InteractionCreate, interaction());
  const stop = bot.stop(); assert.equal(bot.stop(), stop);
  const replies = [];
  client.emit(Events.InteractionCreate, { ...interaction(), reply: async p => replies.push(p) });
  await nextTurn();
  assert.equal(accepted, 1); assert.equal(destroyed, 0); assert.equal(states.at(-1), false);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  finish(); await stop;
  assert.equal(destroyed, 1); assert.equal(disposed, 1); assert.equal(client.listenerCount(Events.InteractionCreate), 0);
});

test('shutdown deadline disposes work and logs never contain raw Discord or handler errors', async () => {
  const client = fakeClient(); client.isReady = () => false;
  const logs = []; let disposed = false;
  const bot = createBot(config(), { client, health: () => {}, clearHealth: () => {}, log: text => logs.push(text), drainMs: 5,
    feature: { handleInteraction: async () => { throw new Error('SECRET'); }, dispose: () => { disposed = true; } },
  });
  client.emit(Events.Error, new Error('SECRET'));
  client.emit(Events.ShardError, new Error('SECRET'));
  client.emit(Events.InteractionCreate, interaction());
  await nextTurn(); await bot.stop();
  assert.equal(disposed, true); assert.ok(logs.every(line => !line.includes('SECRET')));
  const pendingClient = fakeClient();
  let aborted = false;
  const pending = createBot(config(), { client: pendingClient, health: () => {}, clearHealth: () => {}, log: () => {}, drainMs: 5,
    feature: { handleInteraction: () => new Promise(() => {}), dispose: () => { aborted = true; } },
  });
  pendingClient.emit(Events.InteractionCreate, interaction());
  await pending.stop(); assert.equal(aborted, true);
});

test('Gateway readiness alone cannot mark a missing or unavailable configured server healthy', async () => {
  const client = fakeClient(false), states = [], logs = [];
  const bot = createBot(config(), { client, health: ready => states.push(ready), clearHealth: () => {}, log: text => logs.push(text) });
  assert.equal(states.at(-1), false);
  client.guilds.cache.clear(); client.emit(Events.ClientReady);
  assert.equal(states.at(-1), false); assert.match(logs.at(-1), /unavailable/);
  client.guilds.cache.set('guild', { available: true }); client.emit(Events.ClientReady);
  assert.equal(states.at(-1), true);
  client.isReady = () => false; client.emit(Events.ClientReady);
  assert.equal(states.at(-1), false);
  await bot.stop();
});

test('real SDK caches bound users and members, retain the bot, and do not retain messages', async t => {
  const bot = createBot(config(), { health: () => {}, clearHealth: () => {}, log: () => {} });
  t.after(() => bot.stop());
  const client = bot.client;
  client.user = { id: 'bot' };
  const guild = { client, id: 'guild' };
  const members = new GuildMemberManager(guild);
  const messages = new MessageManager({ client, guild });
  for (const cache of [client.users.cache, members.cache]) {
    cache.set('bot', { id: 'bot', client });
    for (let i = 0; i < 500; i++) cache.set(String(i), { id: String(i), client });
    assert.equal(cache.size, 200);
    assert.equal(cache.has('bot'), true);
  }
  messages.cache.set('message', { id: 'message' });
  assert.equal(messages.cache.size, 0);
});
