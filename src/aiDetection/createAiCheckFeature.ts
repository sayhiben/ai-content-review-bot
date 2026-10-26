import type { Interaction } from "discord.js";
import { BotConfig } from "../config";
import { respondPrivateError } from "../discord/privateErrors";
import { AiCheckService } from "./AiCheckService";
import { AiCheckInteractions } from "./interactions";
import { PangramProvider } from "./PangramProvider";
import { GPTZeroProvider } from "./GPTZeroProvider";
import { AiCheckError, AiDetectionProvider, Fetch } from "./types";
import { COMMAND_NAME } from "../discord/command";

export function acceptsInteraction(interaction: Interaction): boolean {
  return (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) ||
    ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(`${COMMAND_NAME}:`));
}

/** Pure composition; constructing a feature never logs in or contacts a provider. */
export function createAiCheckFeature(
  config: Pick<BotConfig, "access" | "detection">,
  dependencies: { providers?: Record<string, AiDetectionProvider>; fetcher?: Fetch; log?: (outcome: string) => void } = {},
) {
  let service: AiCheckService | undefined;
  let handlers: AiCheckInteractions | undefined;
  return {
    async handleInteraction(interaction: Interaction): Promise<void> {
      if (!acceptsInteraction(interaction)) return;
      try {
        if (!config.detection.enabled) throw new AiCheckError("disabled", "AI detection is disabled. Contact a bot administrator.");
        if (!handlers) {
          const { pangram, gptzero } = config.detection;
          const providers = dependencies.providers ?? {
            ...(pangram.enabled && pangram.apiKey ? { pangram: new PangramProvider(pangram.apiKey, pangram.model, pangram.usdPer100Words, dependencies.fetcher) } : {}),
            ...(gptzero.enabled && gptzero.apiKey ? { gptzero: new GPTZeroProvider(gptzero.apiKey, gptzero.modelVersion, gptzero.usdPer1000Words, dependencies.fetcher) } : {}),
          };
          service = new AiCheckService(providers, Date.now, dependencies.log);
          handlers = new AiCheckInteractions(service, config.access, dependencies.fetcher);
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
