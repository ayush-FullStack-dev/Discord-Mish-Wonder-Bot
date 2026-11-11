import { GuildMember, type ButtonInteraction } from "discord.js";
import { Order } from "../../models/order.model.js";
import { cancelOrder } from "../../services/order.service.js";
import { sendError } from "../../ui/utils/sendError.js";
import { sendSuccess } from "../../ui/utils/sendSuccess.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../../utils/error-handler.js";
import { deleteOrderTicket } from "../../helpers/deleteOrderTicket.js";
import { logError } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { errorLog } from "../../../logs/printLogs.js";
import { ADMIN_USERID } from "../../constants/constant.js";
import mongoose from "mongoose";
import { claimFilter, ownedFilter, newConfirmationToken, releaseConfirmation } from "../../services/order-confirmation.service.js";

export async function handleCancelOrder(interaction: ButtonInteraction) {
  const token = newConfirmationToken();
  let claimedId: mongoose.Types.ObjectId | null = null;
  let cancellationUncertain = false;
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
      interaction.deferReply(),
    );

    const buttonId = interaction.customId.split(":")[2];
    const discordUserId = interaction.user.id;

    if (!buttonId || !mongoose.Types.ObjectId.isValid(buttonId)) {
      await logError(
        interaction.client,
        "Invalid Order",
        "The order ID is missing or invalid.",
        { User: discordUserId },
      );

      await sendError(interaction, {
        title: "Invalid Order",
        description: "The order ID is missing or invalid.",
        footer: "Please try again or contact support.",
        ephemeral: false,
      });

      await closeTicket("Invalid order ID");
      return;
    }

    const order = await Order.findById(buttonId)
      .populate("card", "_id last4Digits expiryDate status");

    if (!order) {
      await logError(
        interaction.client,
        "Order Not Found",
        "No order was found for the provided order ID.",
        {
          User: discordUserId,
          "Order ID": buttonId,
        },
      );

      await sendError(interaction, {
        title: "Order Unavailable",
        description: [
          "This order is no longer available in our system.",
          "",
          "**Please place a new order using the same cart code or a different one.**",
        ].join("\n"),
        footer: "The order may have expired or already been removed.",
        ephemeral: false,
      });

      return;
    }

    if (order.confirming !== false) {
      await sendError(interaction, {
        title: "Order Confirmation In Progress",
        description:
          "This order is still being processed. Please wait for the current confirmation process to finish.",
        footer: "Please try again later.",
        ephemeral: true,
      });

      return;
    }

    const checkoutId = order.checkoutId;

    if (
      order.discordUserId !== discordUserId &&
      !ADMIN_USERID.includes(discordUserId)
    ) {
      await logError(
        interaction.client,
        "Unauthorized Order Cancellation",
        "A user attempted to cancel an order that belongs to another user.",
        {
          User: discordUserId,
          "Order Owner": order.discordUserId,
          "Order ID": String(order._id),
        },
      );

      await sendError(interaction, {
        title: "Unauthorized Access",
        description: "You are not authorized to cancel this order.",
        footer: "Only the order owner or an authorized admin can cancel it.",
        ephemeral: true,
      });

      return;
    } else if (order.status !== "pending") {
      const statusMessages = {
        confirmed: "This order has already been confirmed successfully.",
        failed: "This order has failed and cannot be cancelled.",
        cancelled: "This order has already been cancelled.",
        unknown: "We couldn't verify the status of this order.",
      } as const;

      const description =
        statusMessages[order.status as keyof typeof statusMessages] ??
        "This order cannot be cancelled at the moment.";

      await logError(
        interaction.client,
        "Order Cannot Be Cancelled",
        description,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          Status: order.status,
        },
      );

      await sendError(interaction, {
        title: "Order Cannot Be Cancelled",
        description,
        footer: "Only pending orders can be cancelled.",
        ephemeral: false,
      });

      return;
    }

    if (typeof checkoutId !== "string" || !checkoutId.trim()) {
      await logError(
        interaction.client,
        "Checkout Unavailable",
        "The checkout ID for this order is unavailable.",
        {
          User: discordUserId,
          "Order ID": String(order._id),
        },
      );

      await sendError(interaction, {
        title: "Order Unavailable",
        description: "The checkout ID for this order is unavailable.",
        footer: "Please contact support before trying again.",
        ephemeral: false,
      });
      return;
    }

    let result;

    const claimed = await Order.findOneAndUpdate(
      { ...claimFilter(String(order._id), discordUserId, ADMIN_USERID.includes(discordUserId)), checkoutId },
      { $set: { confirming: true, confirmationToken: token } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      await sendError(interaction, { title: "Order Busy", description: "The order changed or is being processed. Please contact support if needed." });
      return;
    }
    claimedId = claimed._id;

    try {
      cancellationUncertain = true;
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
        ephemeral: false,
      });
      return;
    }

    const updatedOrder = await Order.findOneAndUpdate(
      {
        ...ownedFilter(order._id, token),
      },
      {
        $set: {
          status: "cancelled",
          confirming: false,
          confirmationToken: null,
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
        ephemeral: false,
      });
      return;
    }

    cancellationUncertain = false;

    await Card.findOneAndUpdate(
      { _id: order.card?._id },
      { $set: { isLocked: false } },
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
      ephemeral: false,
    });

    await closeTicket("Order cancelled");
  } catch (error) {
    await logError(interaction.client, "Order Cancellation Error", error, {
      User: interaction.user.id,
    });

    errorLog("Unexpected error in handleCancelOrder:", error);

    await handleInteractionError(
      interaction,
      error,
      "Failed to process order cancellation",
    );
  } finally {
    if (claimedId && !cancellationUncertain) {
      await releaseConfirmation(claimedId, token).catch((error) => errorLog("Cancellation lock release failed", error));
    }
  }
}
