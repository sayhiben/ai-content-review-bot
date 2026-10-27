// Preloaded only in isolated CLI tests, after the network guard.
const { mock } = require('node:test');
const mode = process.env.TEST_CLI_MODE;
if (mode.startsWith('main-') && mode !== 'main-config-error') {
  mock.method(require('../dist/config'), 'botConfig', () => require('./fixtures.cjs').config());
  mock.method(require('../dist/bot'), 'createBot', () => ({
    login: async () => {
      if (mode === 'main-login-error') throw new Error('SECRET');
      setImmediate(() => process.emit(mode === 'main-sigint' ? 'SIGINT' : 'SIGTERM'));
    },
    stop: async () => {
      console.log('Stopped fixture bot');
      if (mode === 'main-stop-error') throw new Error('SECRET');
    },
  }));
}
if (mode.startsWith('register-')) {
  Object.assign(process.env, { DISCORD_TOKEN: 'TEST_ONLY', DISCORD_APPLICATION_ID: '12345678901234567', DISCORD_GUILD_ID: '12345678901234568' });
  mock.method(require('discord.js').REST.prototype, 'post', async () => {
    if (mode === 'register-error') throw new Error('SECRET');
    console.log('Registered fixture command');
  });
}
