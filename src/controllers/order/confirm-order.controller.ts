import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";

import { Order } from "../../models/order.model.js";
import { confirmOrder } from "../../services/order.service.js";
import { createConfirmedOrderPanel } from "../../ui/order/createConfirmedOrderPanel.js";
import { sendError } from "../../ui/utils/sendError.js";
import { handleInteractionError } from "../../utils/error-handler.js";

export async function handleConfirmOrder(interaction: ButtonInteraction) {
  try {
    await interaction.deferReply({
     flags: MessageFlags.Ephemeral,
    });

    const checkoutId = interaction.customId.split(":")[2];
    const discordUserId = interaction.user.id;

    if (!checkoutId) {
      await sendError(interaction, {
        title: "Invalid Checkout",
        description: "The checkout ID is missing or invalid.",
        footer: "Please try again or contact support.",
      });
      return;
    }

    const order = await Order.findOne({
      checkoutId,
      discordUserId,
      status: "pending",
    });

    if (!order) {
      await sendError(interaction, {
        title: "Order Not Found",
        description:
          "No pending order was found. It may already be confirmed, cancelled, or expired.",
        footer: "Only pending orders can be confirmed.",
      });
      return;
    }

    const result = await confirmOrder(checkoutId);

    if (!result.ok) {
      await sendError(interaction, {
        title: "Order Confirmation Failed",
        description: result.message,
        footer: "Your order has not been marked as confirmed.",
      });
      return;
    }

    const data = result.data;

    try {
      await Order.findOneAndUpdate(
        {
          _id: order._id,
          discordUserId,
          status: "pending",
        },
        {
          $set: {
            status: "confirmed",
            orderId: data.order_id,
            trackingUrl: data.tracking,
            total: data.price.total,
            expiresAt: null,
          },
        },
      );
    } catch (error) {}

    const panel = createConfirmedOrderPanel({ order: data });

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(panel);
    } else {
      await interaction.reply({
        ...panel,
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const channel = interaction.channel;

    const displayName =
      interaction.member instanceof GuildMember
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);

    if (channel?.type === ChannelType.GuildText) {
      await channel.setName(
        `✅-order-${displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
      );
    }
  } catch (error) {
    console.error("Failed to confirm order:", error);

    await handleInteractionError(interaction, error, "Failed to confirm order");
  }
}
