const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { createAiCheckFeature } = require('../dist/aiDetection/createAiCheckFeature');
const { text, result, config } = require('./fixtures.cjs');

test('feature and runtime imports never start the bot or register commands', () => {
  require('../dist/main'); require('../dist/registerCommands');
  assert.ok(require.cache[require.resolve('../dist/main')]);
});

test('disabled feature responds privately without constructing or calling a provider', async t => {
  const settings = config(); settings.detection.enabled = false;
  const feature = createAiCheckFeature(settings, { fetcher: () => assert.fail('must not request') });
  t.after(() => feature.dispose());
  const replies = [];
  await feature.handleInteraction({
    commandName: 'ai-check', isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false,
    reply: async p => replies.push(p),
  });
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].content, /disabled/);
});

test('one feature boundary handles command, modal, and component errors privately', async t => {
  let scans = 0, modal;
  const edits = [], replies = [];
  const feature = createAiCheckFeature(config(), { provider: { name: 'Fixture', minimumWords: 50, analyze: async input => { scans++; return result(input); } } });
  t.after(() => feature.dispose());
  const channel = { id: 'chat', isThread: () => false, permissionsFor: () => ({ has: () => true }) };
  const member = { id: 'requester', roles: { cache: new Map() } };
  const input = {
    id: 'command', commandName: 'ai-check', user: member, member, guildId: 'guild', channelId: 'chat', channel,
    guild: { members: { fetch: async () => member }, channels: { fetch: async () => channel } },
    isChatInputCommand: () => true, isModalSubmit: () => false, isButton: () => false,
    options: { getAttachment: () => null }, showModal: async m => { modal = m.toJSON(); },
    reply: async p => replies.push(p),
  };
  await feature.handleInteraction(input);
  const submit = { ...input, id: 'modal', customId: modal.custom_id, createdTimestamp: Date.now(), isChatInputCommand: () => false, isModalSubmit: () => true,
    fields: { getTextInputValue: () => text }, deferReply: async p => { assert.equal(p.flags, MessageFlags.Ephemeral); submit.deferred = true; },
    editReply: async p => { edits.push(p); return { id: 'private' }; },
  };
  await feature.handleInteraction(submit);
  assert.equal(scans, 1); assert.ok(edits[0].files.some(f => f.name === 'ai-report.txt'));
  await feature.handleInteraction({ ...input, showModal: async () => { throw new Error('SECRET_TOKEN'); } });
  assert.ok(!replies.at(-1).content.includes('SECRET')); assert.equal(replies.at(-1).flags, MessageFlags.Ephemeral);
  await feature.handleInteraction({ ...input, isChatInputCommand: () => false, isButton: () => true, customId: 'ai-check:invalid', deferUpdate: async () => { throw new Error('SECRET_TOKEN'); } });
  assert.ok(!replies.at(-1).content.includes('SECRET')); assert.equal(replies.at(-1).flags, MessageFlags.Ephemeral);
  await feature.handleInteraction({ ...input, commandName: 'unrelated', reply: () => assert.fail('must ignore') });
});
