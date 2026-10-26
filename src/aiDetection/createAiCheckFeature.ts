import type { Interaction } from "discord.js";
import { BotConfig } from "../config";
import { respondPrivateError } from "../discord/privateErrors";
import { AiCheckService } from "./AiCheckService";
import { AiCheckInteractions } from "./interactions";
import { PangramProvider } from "./PangramProvider";
import { AiCheckError, AiDetectionProvider, Fetch } from "./types";
import { COMMAND_NAME } from "../discord/command";

export function acceptsInteraction(interaction: Interaction): boolean {
  return (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) ||
    ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(`${COMMAND_NAME}:`));
}

/** Pure composition; constructing a feature never logs in or contacts a provider. */
export function createAiCheckFeature(
  config: BotConfig,
  dependencies: { provider?: AiDetectionProvider; fetcher?: Fetch; log?: (outcome: string) => void } = {},
) {
  let service: AiCheckService | undefined;
  let handlers: AiCheckInteractions | undefined;
  return {
    async handleInteraction(interaction: Interaction): Promise<void> {
      if (!acceptsInteraction(interaction)) return;
      try {
        if (!config.detection.enabled) throw new AiCheckError("disabled", "AI detection is disabled. Contact a bot administrator.");
        if (!handlers) {
          const provider = dependencies.provider ?? new PangramProvider(config.apiKey!, config.detection.model, config.detection.usdPer100Words, dependencies.fetcher);
          service = new AiCheckService(provider, Date.now, dependencies.log);
          handlers = new AiCheckInteractions(service, {
            guildId: config.detection.guildId, channelId: config.channelId, roleId: config.roleId,
          }, dependencies.fetcher);
        }
        if (interaction.isChatInputCommand()) await handlers.execute(interaction);
        else await handlers.handle(interaction);
      } catch (error) {
        if (interaction.isChatInputCommand() || interaction.isButton() || interaction.isModalSubmit()) await respondPrivateError(interaction, error);
      }
    },
    dispose() { service?.dispose(); },
  };
}
