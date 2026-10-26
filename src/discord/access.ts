export interface AccessConfig {
  guildId: string;
  channelId: string;
  roleId: string;
  allowThreads: boolean;
}

/** Channel access OR the configured role, always within the configured guild. */
export function authorized(access: AccessConfig, guildId: string | null, channelId: string,
  parentId: string | null | undefined, roles: readonly string[]): boolean {
  return guildId === access.guildId && (channelId === access.channelId ||
    (access.allowThreads && parentId === access.channelId) || roles.includes(access.roleId));
}

export function accessExplanation(access: AccessConfig, guildId: string | null): string {
  if (guildId !== access.guildId) return "This command is available only in the configured server.";
  return `Use this command in <#${access.channelId}>${access.allowThreads ? " or its threads" : ""}, or with the <@&${access.roleId}> role in this server.`;
}
