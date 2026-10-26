import { createBot } from "./bot";
import { botConfig, ConfigurationError } from "./config";

export async function main(): Promise<void> {
  const bot = createBot(botConfig());
  const stop = () => { void bot.stop().then(() => process.exit(0), () => process.exit(1)); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try { await bot.login(); }
  catch {
    await bot.stop();
    throw new Error("Bot login failed.");
  }
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof ConfigurationError ? error.message : "Bot startup failed. Check configuration and connectivity.");
    process.exitCode = 1;
  });
}
