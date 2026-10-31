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
import { logSuccess, logError } from "../../utils/logger.js";
import { randomUUID } from "node:crypto";
import { releaseCardLockIfUnused } from "../../services/card.service.js";
import { createPendingOrderClaimFilter } from "../../services/order-confirmation.service.js";

export async function handleCancelOrder(interaction: ButtonInteraction) {
  let claimedOrderId: typeof Order.prototype._id | null = null;
  let claimedOrderExpiresAt: Date | null = null;
  let confirmationToken: string | null = null;
  let providerRequestStarted = false;

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
        ephemeral: false,
      });

      await closeTicket("Invalid checkout ID");
      return;
    }

    const checkoutExpiry = await Order.findOne(
      createPendingOrderClaimFilter(checkoutId, discordUserId, new Date()),
    )
      .select("_id expiresAt")
      .lean()
      .exec();

    confirmationToken = randomUUID();
    claimedOrderExpiresAt = checkoutExpiry?.expiresAt ?? null;

    const order = checkoutExpiry
      ? await Order.findOneAndUpdate(
          createPendingOrderClaimFilter(checkoutId, discordUserId, new Date()),
          {
            $set: {
              confirming: true,
              confirmationState: "claimed",
              confirmationToken,
              confirmationStartedAt: new Date(),
              confirmationExpiresAt: checkoutExpiry.expiresAt,
              expiresAt: null,
            },
          },
          { returnDocument: "after", upsert: false },
        )
          .populate("card", "_id last4Digits expiryDate status")
          .exec()
      : null;

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
        ephemeral: false,
      });
      return;
    }
    claimedOrderId = order._id;

    const requestStarted = await Order.updateOne(
      {
        _id: order._id,
        status: "pending",
        confirming: true,
        confirmationState: "claimed",
        confirmationToken,
      },
      {
        $set: {
          confirmationState: "cancel_requested",
          confirmationStartedAt: new Date(),
        },
      },
    );

    if (requestStarted.matchedCount !== 1) {
      throw new Error("The order lock was lost before cancellation request.");
    }

    let result;

    try {
      providerRequestStarted = true;
      result = await cancelOrder(checkoutId);
    } catch (error) {
      await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: "pending",
          confirming: true,
          confirmationState: "cancel_requested",
          confirmationToken,
        },
        {
          $set: {
            status: "unknown",
            confirming: false,
            confirmationState: "unknown",
            confirmationToken: null,
            confirmationStartedAt: null,
            confirmationExpiresAt: null,
            expiresAt: null,
          },
        },
        { returnDocument: "after", upsert: false },
      ).exec();

      await logError(
        interaction.client,
        "Order Cancellation Requires Reconciliation",
        error,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );
      await sendError(interaction, {
        title: "Cancellation Status Uncertain",
        description:
          "The cancellation result could not be verified. This checkout cannot be retried safely. Support has been notified.",
        footer: "Please contact support before confirming or cancelling again.",
        ephemeral: false,
      });
      return;
    }

    if (!result.ok) {
      await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: "pending",
          confirming: true,
          confirmationToken,
        },
        {
          $set: {
            status: "unknown",
            confirming: false,
            confirmationState: "unknown",
            confirmationToken: null,
            confirmationStartedAt: null,
            confirmationExpiresAt: null,
            expiresAt: null,
          },
        },
        { returnDocument: "after", upsert: false },
      ).exec();

      await logError(
        interaction.client,
        "Order Cancellation Requires Reconciliation",
        `The provider response for checkout ${checkoutId} was not definitive. No confirmation or cancellation request will be retried.`,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );

      await sendError(interaction, {
        title: "Cancellation Status Uncertain",
        description:
          "The provider did not return a definitive cancellation result. This checkout cannot be retried safely. Support has been notified.",
        footer: "Please contact support before confirming or cancelling again.",
        ephemeral: false,
      });
      return;
    }

    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        discordUserId,
        status: "pending",
        confirming: true,
        confirmationState: "cancel_requested",
        confirmationToken,
      },
      {
        $set: {
          status: "cancelled",
          confirming: false,
          confirmationState: null,
          confirmationToken: null,
          confirmationStartedAt: null,
          confirmationExpiresAt: null,
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

    await logSuccess(
      interaction.client,
      "Order Cancelled",
      "The checkout was cancelled successfully and the local order record was updated.",
      {
        User: discordUserId,
        "Checkout ID": checkoutId,
      },
    );

    try {
      await releaseCardLockIfUnused(order.card?._id);
    } catch (error) {
      await logError(interaction.client, "Card Unlock Failed", error, {
        User: discordUserId,
        "Checkout ID": checkoutId,
      });
    }

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

    console.error("Unexpected error in handleCancelOrder:", error);

    await handleInteractionError(
      interaction,
      error,
      "Failed to process order cancellation",
    );
  } finally {
    if (claimedOrderId && confirmationToken && !providerRequestStarted) {
      try {
        await Order.updateOne(
          {
            _id: claimedOrderId,
            status: "pending",
            confirming: true,
            confirmationState: "claimed",
            confirmationToken,
          },
          {
            $set: {
              confirming: false,
              confirmationState: null,
              confirmationToken: null,
              confirmationStartedAt: null,
              expiresAt: claimedOrderExpiresAt,
              confirmationExpiresAt: null,
            },
          },
        );
      } catch (error) {
        await logError(
          interaction.client,
          "Failed to Release Cancellation Lock",
          error,
          {
            User: interaction.user.id,
            "Confirmation Token": confirmationToken,
          },
        );
      }
    }
  }
}
