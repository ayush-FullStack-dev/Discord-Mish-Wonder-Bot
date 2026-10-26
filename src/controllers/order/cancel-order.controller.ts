import { GuildMember, MessageFlags, type ButtonInteraction } from "discord.js";
import { Order } from "../../models/order.model.js";
import { cancelOrder } from "../../services/order.service.js";
import { sendError } from "../../ui/utils/sendError.js";
import { sendSuccess } from "../../ui/utils/sendSuccess.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../../utils/error-handler.js";
import { deleteOrderTicket } from "../../helpers/deleteOrderTicket.js";
import { logSuccess, logError } from "../../utils/logger.js";

export async function handleCancelOrder(interaction: ButtonInteraction) {
  const displayName =
    interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : (interaction.user.globalName ?? interaction.user.username);

  const closeTicket = (reason: string) =>
    deleteOrderTicket(interaction, {
      reason,
      channelName: `❌-order-${displayName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 85)}`,
      delay: 10_000,
    });

  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const checkoutId = interaction.customId.split(":")[2];
    const discordUserId = interaction.user.id;

    if (!checkoutId) {
      await logError(
        interaction.client,
        "Invalid Checkout",
        "The checkout ID is missing or invalid.",
        { User: discordUserId },
      );

      await sendError(interaction, {
        title: "Invalid Checkout",
        description: "The checkout ID is missing or invalid.",
        footer: "Please try again or contact support.",
      });

      await closeTicket("Invalid checkout ID");
      return;
    }

    const order = await Order.findOne({
      checkoutId,
      discordUserId,
      status: "pending",
      confirming: false,
    });

    if (!order) {
      await logError(
        interaction.client,
        "Order Not Found",
        "No pending order was found for this user.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );

      await sendError(interaction, {
        title: "Order Not Found",
        description: [
          "We couldn't find a pending order associated with your account.",
          "",
          "It may already be confirmed, cancelled, or expired.",
        ].join("\n"),
        footer: "Only pending orders can be cancelled.",
      });
      return;
    }

    let result;

    try {
      result = await cancelOrder(checkoutId);
    } catch (error) {
      await logError(interaction.client, "Order Cancellation Failed", error, {
        User: discordUserId,
        "Checkout ID": checkoutId,
      });

      await handleInteractionError(
        interaction,
        error,
        "Failed to cancel order",
      );
      return;
    }

    if (!result.ok) {
      await logError(
        interaction.client,
        "Order Cancellation Failed",
        result.message,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );

      await sendError(interaction, {
        title: "Cancellation Failed",
        description: result.message,
        footer:
          "Your order has not been marked as cancelled. You can try again.",
      });
      return;
    }

    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        discordUserId,
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          expiresAt: null,
        },
      },
      {
        returnDocument: "after",
      },
    );

    if (!updatedOrder) {
      await logError(
        interaction.client,
        "Order Update Failed",
        "The checkout was cancelled by the provider, but the local order record could not be updated.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );

      await sendError(interaction, {
        title: "Order Update Failed",
        description:
          "The checkout was cancelled, but we couldn't update its local order record.",
        footer: "Please contact support to verify your order status.",
      });
      return;
    }

    await logSuccess(
      interaction.client,
      "Order Cancelled",
      "The checkout was cancelled successfully and the local order record was updated.",
      {
        User: discordUserId,
        "Checkout ID": checkoutId,
      },
    );

    await sendSuccess(interaction, {
      title: "Order Cancelled",
      description: [
        "Your checkout has been cancelled successfully.",
        "",
        `**Checkout ID:** \`${checkoutId}\``,
        "**Status:** Cancelled",
        "",
        "You can now create a new order.",
      ].join("\n"),
      footer: "Your order record has been updated.",
    });

    await closeTicket("Order cancelled");
  } catch (error) {
    await logError(interaction.client, "Order Cancellation Error", error, {
      User: interaction.user.id,
    });

    console.error("Unexpected error in handleCancelOrder:", error);

    await handleInteractionError(
      interaction,
      error,
      "Failed to process order cancellation",
    );
  }
}
