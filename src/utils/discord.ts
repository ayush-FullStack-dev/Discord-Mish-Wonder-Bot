import {
  ChannelType,
  Message,
  type BaseInteraction,
  type TextChannel,
} from "discord.js";
import { errorLog } from "../../logs/printLogs.js";
import { Order } from "../models/order.model.js";
import { Card } from "../models/card.model.js";
import { sendOrderExpired } from "../ui/order/sendOrderExpired.js";

export async function setChannelName(
  interaction: BaseInteraction,
  name: string,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel || !("setName" in channel)) return;

  await channel.setName(name).catch(errorLog);
}

export async function notifyOrderExpired(
  ticket: TextChannel,
  cardId: typeof Card.prototype._id,
  checkoutMessage: Message<boolean>,
  expiresIn: number,
): Promise<void> {
  const channelName = `⌛-${ticket.name.replace(/^[^\w]+-/, "")}`;

  const usingCard = await Order.findOne({
    card: cardId,
    status: "pending",
  });

  if (!usingCard) {
    await Card.findByIdAndUpdate(cardId, {
      $set: { isLocked: false },
    });
  }

  await sendOrderExpired({
    replyTo: checkoutMessage,
    expiresIn,
  });

  await updateTicketChannel(ticket, channelName);
}

export async function updateOrderChannel(
  interaction: BaseInteraction,
  name: string,
): Promise<void> {
  try {
    await setChannelName(interaction, name);
  } catch (error) {
    errorLog("Failed to update order channel name:", error);
  }
}

export async function updateTicketChannel(
  ticket: TextChannel,
  name: string,
): Promise<void> {
  try {
    if (ticket.type !== ChannelType.GuildText) return;

    await ticket.setName(name);
  } catch (error) {
    errorLog("Failed to update ticket channel name:", error);
  }
}
