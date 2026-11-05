import { BaseInteraction } from "discord.js";
import { errorLog } from "../../logs/printLogs.js";

export async function setChannelName(
  interaction: BaseInteraction,
  name: string,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel || !("setName" in channel)) return;

  await channel.setName(name).catch(console.error);
}

export async function updateOrderChannel(
  interaction: BaseInteraction,
  name: string,
) {
  try {
    await setChannelName(interaction, name);
  } catch (error) {
    errorLog("Failed to update order channel name:", error);
  }
}
