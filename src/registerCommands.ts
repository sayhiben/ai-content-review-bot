import { REST, Routes } from "discord.js";
import { ConfigurationError, registrationConfig } from "./config";
import { aiCheckBuilder } from "./discord/command";

/** Dry-run by default. Only --apply writes to this application's configured guild. */
export async function registerCommands(args = process.argv.slice(2), env = process.env,
  transport?: Pick<REST, "put">, output: (message: string) => void = console.log): Promise<void> {
  if (args.some(arg => arg !== "--apply")) throw new ConfigurationError("Usage: npm run commands [-- --apply]");
  const body = [aiCheckBuilder().toJSON()];
  if (!args.includes("--apply")) { output(JSON.stringify(body, null, 2)); return; }
  const config = registrationConfig(env);
  const rest = transport ?? new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body });
  output("Registered /ai-check for the configured application and guild.");
}

if (require.main === module) {
  void registerCommands().catch(error => {
    console.error(error instanceof ConfigurationError ? error.message : "Command registration failed. Check configuration and permissions.");
    process.exitCode = 1;
  });
}
