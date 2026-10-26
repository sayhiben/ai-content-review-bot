const text = 'The neighbors gathered near the garden to discuss local events. '.repeat(10).trim();
const pangram = (source = text, label = 'AI-Generated') => ({
  stage: 'STAGE_SUCCESS', text: source, version: 'fixture-4.1', headline: 'Possibly AI',
  prediction: 'This short text may be AI generated.',
  fraction_ai: label === 'AI-Generated' ? 1 : 0,
  fraction_ai_assisted: label === 'AI-Assisted' ? 1 : 0,
  fraction_human: label === 'Human Written' ? 1 : 0,
  windows: [{ text: source, label, confidence: 'Low', start_index: 0, end_index: Array.from(source).length }],
});
const result = (source = text) => ({
  provider: 'Test detector', model: 'fixture', analyzedText: source,
  headline: 'Possibly AI', explanation: 'Uncertain fixture result',
  textFractions: { ai: 1, assisted: 0, human: 0 },
  segments: [{ text: source, category: 'ai', label: 'AI-Generated', confidence: 'Low', range: { start: 0, end: source.length } }],
});
const context = { userId: 'requester', guildId: 'guild', channelId: 'chat' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const access = { guildId: 'guild', channelId: 'chat', roleId: 'reviewer', allowThreads: true };
const config = () => ({ token: 'TEST_ONLY', access: { ...access }, detection: { enabled: true,
  pangram: { enabled: true, apiKey: 'TEST_ONLY', model: 'pangram-4', usdPer100Words: .05 },
  gptzero: { enabled: false },
} });
module.exports = { text, pangram, result, context, json, access, config };
