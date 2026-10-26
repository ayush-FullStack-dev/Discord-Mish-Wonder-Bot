import { ChannelType, MessageFlags, type ButtonInteraction } from "discord.js";

interface DeleteOrderTicketOptions {
  reason?: string;
  channelName?: string | null;
  delay?: number;
}

export async function deleteOrderTicket(
  interaction: ButtonInteraction,
  {
    reason = "Order ticket closed",
    channelName,
    delay = 10_000,
  }: DeleteOrderTicketOptions = {},
): Promise<void> {
  const channel = interaction.channel;

  if (channel?.type !== ChannelType.GuildText) return;

  try {
    if (channelName) {
      await channel.setName(channelName);
    }

    await channel.send(
      `**This ticket will be deleted in ${delay / 1000} seconds.**\n`,
    );

    setTimeout(() => {
      void channel.delete(reason).catch((error: unknown) => {
        console.error("Failed to delete order ticket:", error);
      });
    }, delay);
  } catch (error) {
    console.error("Failed to schedule order ticket deletion:", error);
    await interaction
      .reply({
        content: `Failed to close the order: ${
          error instanceof Error ? error.message : String(error)
        }`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}
