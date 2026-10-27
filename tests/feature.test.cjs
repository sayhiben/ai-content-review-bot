const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { createAiCheckFeature } = require('../dist/aiDetection/createAiCheckFeature');
const { text, result, config, provider } = require('./fixtures.cjs');

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
  const feature = createAiCheckFeature(config(), { providers: { fixture: provider({ analyze: async input => { scans++; return result(input); } }) } });
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

test('configured availability determines automatic provider or picker without health probes', async t => {
  for (const [pangramEnabled, pangramKey, zeroEnabled, zeroKey, expected] of [
    [true, 'TEST', false, 'TEST', ['Pangram']],
    [false, 'TEST', true, 'TEST', ['GPTZero']],
    [true, undefined, true, 'TEST', ['GPTZero']],
    [true, 'TEST', true, 'TEST', ['Pangram', 'GPTZero']],
    [false, 'TEST', false, 'TEST', []],
  ]) {
    const settings = config();
    Object.assign(settings.detection.pangram, { enabled: pangramEnabled, apiKey: pangramKey });
    Object.assign(settings.detection.gptzero, { enabled: zeroEnabled, apiKey: zeroKey });
    const feature = createAiCheckFeature(settings, { fetcher: () => assert.fail('configuration must not probe services') });
    t.after(() => feature.dispose());
    let modal, reply;
    await feature.handleInteraction({
      id: 'command', commandName: 'ai-check', guildId: 'guild', channelId: 'chat', channel: { isThread: () => false },
      user: { id: 'requester' }, member: { roles: [] },
      isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false,
      options: { getAttachment: () => null }, showModal: async m => { modal = m.toJSON(); }, reply: async p => { reply = p; },
    });
    if (expected.length === 2) assert.deepEqual(modal.components[0].component.options.map(o => o.label), expected);
    else if (expected.length === 1) {
      assert.equal(modal.components.length, 1); assert.equal(modal.components[0].label, `Text to send to ${expected[0]}`);
    } else {
      assert.equal(modal, undefined); assert.equal(reply.flags, MessageFlags.Ephemeral); assert.match(reply.content, /No AI detection provider/);
    }
  }
});
