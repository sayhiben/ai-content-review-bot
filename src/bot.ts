import { Client, Events, GatewayIntentBits, Interaction, MessageFlags, Options } from "discord.js";
import { acceptsInteraction, createAiCheckFeature } from "./aiDetection/createAiCheckFeature";
import { BotConfig } from "./config";
import { clearHealth, writeHealth } from "./health";
import { LIMITS } from "./aiDetection/types";

type Feature = ReturnType<typeof createAiCheckFeature>;

/** Construct only. login() is an explicit operation owned by the CLI entrypoint. */
export function createBot(config: BotConfig, options: {
  client?: Client;
  feature?: Feature;
  log?: (message: string) => void;
  health?: (ready: boolean) => void;
  clearHealth?: () => void;
  drainMs?: number;
} = {}) {
  const log = options.log ?? console.log;
  const client = options.client ?? new Client({
    intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMemberManager: { maxSize: 200, keepOverLimit: member => member.id === member.client.user?.id },
      UserManager: { maxSize: 200, keepOverLimit: user => user.id === user.client.user?.id },
    }),
  });
  const feature = options.feature ?? createAiCheckFeature({ access: config.access, detection: config.detection }, { log: outcome => log(`Analysis outcome: ${outcome}`) });
  const active = new Set<Promise<void>>();
  let draining = false;
  let shutdown: Promise<void> | undefined;
  const ready = () => client.isReady() && !!client.guilds.cache.get(config.access.guildId)?.available && !draining;
  const heartbeat = () => {
    try { (options.health ?? writeHealth)(ready()); }
    catch { log("Health status could not be written."); }
  };
  const timer = setInterval(heartbeat, 15_000);
  timer.unref();
  heartbeat();

  async function dispatch(interaction: Interaction): Promise<void> {
    if (!acceptsInteraction(interaction)) return;
    if (draining) {
      await interaction.reply({ content: "The bot is restarting. Please try again shortly.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await feature.handleInteraction(interaction);
  }
  const onInteraction = (interaction: Interaction) => {
    const task = dispatch(interaction).catch(() => log("An interaction could not be completed."));
    active.add(task);
    void task.finally(() => active.delete(task));
  };
  const onReady = () => { heartbeat(); log(ready() ? "AI Content Review Bot is ready." : "Connected to Discord; the configured server is unavailable."); };
  const onError = () => log("Discord client reported an error.");
  client.on(Events.InteractionCreate, onInteraction);
  client.on(Events.ClientReady, onReady);
  client.on(Events.Error, onError);
  client.on(Events.ShardError, onError);

  return {
    client,
    login: () => client.login(config.token),
    stop(): Promise<void> {
      if (shutdown) return shutdown;
      draining = true;
      heartbeat();
      shutdown = (async () => {
        let timeout!: ReturnType<typeof setTimeout>;
        try {
          await Promise.race([
            Promise.allSettled([...active]),
            new Promise<void>(resolve => { timeout = setTimeout(resolve, options.drainMs ?? LIMITS.analysisMs + 15_000); }),
          ]);
        } finally {
          clearTimeout(timeout);
          clearInterval(timer);
          feature.dispose();
          client.off(Events.InteractionCreate, onInteraction);
          client.off(Events.ClientReady, onReady);
          client.off(Events.Error, onError);
          client.off(Events.ShardError, onError);
          await client.destroy();
          try { (options.clearHealth ?? clearHealth)(); } catch { log("Health status could not be cleared."); }
          log("AI Content Review Bot stopped.");
        }
      })();
      return shutdown;
    },
  };
}
