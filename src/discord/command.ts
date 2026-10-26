import { SlashCommandBuilder } from "discord.js";
import { LIMITS } from "../aiDetection/types";

export const COMMAND_NAME = "ai-check";

export function aiCheckBuilder() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Check Reddit text for AI-generated content with a private report")
    // Registration uses the guild route. Global-only context/install fields are omitted.
    .addAttachmentOption(option => option.setName("file")
      .setDescription(`UTF-8 .txt file; up to ${LIMITS.words.toLocaleString("en-US")} words and ${LIMITS.bytes / 1024} KiB`));
}
