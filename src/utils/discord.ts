import { BaseInteraction } from "discord.js";

export async function setChannelName(
  interaction: BaseInteraction,
  name: string,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel || !("setName" in channel)) return;

  await channel.setName(name).catch(console.error);
}
