const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { createBot } = require('../dist/bot');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const interaction = () => ({ commandName: 'ai-check', isChatInputCommand: () => true, isRepliable: () => true });
const config = { token: 'SYNTHETIC', channelId: 'chat', roleId: 'mod', detection: { enabled: false, guildId: 'guild' } };

test('client uses only the unprivileged Guilds intent and suppresses mentions by default', async () => {
  const bot = createBot(config, { health: () => {}, clearHealth: () => {}, log: () => {} });
  assert.equal(bot.client.options.intents.bitfield, GatewayIntentBits.Guilds);
  assert.deepEqual(bot.client.options.allowedMentions.parse, []);
  await bot.stop();
});

test('shutdown drains accepted work, rejects new work privately, and destroys once', async () => {
  const client = new EventEmitter(); let logins = 0, destroyed = 0, disposed = 0, accepted = 0, finish;
  client.login = async token => { assert.equal(token, 'SYNTHETIC'); logins++; };
  client.isReady = () => true; client.destroy = async () => { destroyed++; };
  const states = [];
  const bot = createBot(config, { client, health: ready => states.push(ready), clearHealth: () => {}, log: () => {},
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
  const client = new EventEmitter(); client.isReady = () => false; client.destroy = async () => {};
  const logs = []; let disposed = false;
  const bot = createBot(config, { client, health: () => {}, clearHealth: () => {}, log: text => logs.push(text), drainMs: 5,
    feature: { handleInteraction: async () => { throw new Error('SECRET'); }, dispose: () => { disposed = true; } },
  });
  client.emit(Events.Error, new Error('SECRET'));
  client.emit(Events.ShardError, new Error('SECRET'));
  client.emit(Events.InteractionCreate, interaction());
  await nextTurn(); await bot.stop();
  assert.equal(disposed, true); assert.ok(logs.every(line => !line.includes('SECRET')));
  const pendingClient = new EventEmitter(); pendingClient.isReady = () => true; pendingClient.destroy = async () => {};
  let aborted = false;
  const pending = createBot(config, { client: pendingClient, health: () => {}, clearHealth: () => {}, log: () => {}, drainMs: 5,
    feature: { handleInteraction: () => new Promise(() => {}), dispose: () => { aborted = true; } },
  });
  pendingClient.emit(Events.InteractionCreate, interaction());
  await pending.stop(); assert.equal(aborted, true);
});
