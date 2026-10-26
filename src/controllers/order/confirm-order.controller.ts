import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";

import { Order } from "../../models/order.model.js";
import { confirmOrder, editOrder } from "../../services/order.service.js";
import { createConfirmedOrderPanel } from "../../ui/order/createConfirmedOrderPanel.js";
import { sendError } from "../../ui/utils/sendError.js";
import { attemptInteractionResponse, handleInteractionError } from "../../utils/error-handler.js";
import { deductBalance, getBalance } from "../../services/balance.service.js";
import { centsToDollars, dollarsToCents } from "../../utils/util.js";

export async function handleConfirmOrder(interaction: ButtonInteraction) {
  let claimedOrderId: typeof Order.prototype._id | null = null;

  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

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

    const order = await Order.findOneAndUpdate(
      {
        checkoutId,
        discordUserId,
        status: "pending",
        confirming: { $ne: true },
      },
      {
        $set: { confirming: true },
      },
      {
        returnDocument: "after",
        upsert: false,
      },
    ).exec();

    if (!order) {
      await sendError(interaction, {
        title: "Order Not Available",
        description:
          "This order is already being confirmed or is no longer pending.",
        footer: "Please check your order status and try again.",
      });
      return;
    }

    claimedOrderId = order._id;

    const balance = await getBalance(discordUserId);

    if (balance === null) {
      await sendError(interaction, {
        title: "Wallet Not Found",
        description: "You don't have a wallet to confirm this order.",
        footer: "Please deposit funds and try again.",
      });
      return;
    }

    const dollarBalance = Number(centsToDollars(balance));

    if (order.total > dollarBalance) {
      const additionalFunds = (order.total - dollarBalance).toFixed(2);

      await sendError(interaction, {
        title: "Insufficient Funds",
        description: [
          `Your current balance is $${dollarBalance.toFixed(2)}.`,
          `The order total is $${order.total.toFixed(2)}.`,
          "",
          `You need an additional $${additionalFunds} to confirm this order.`,
        ].join("\n"),
        footer: "Please deposit more funds or choose a different order.",
      });
      return;
    }

    const result = await confirmOrder(checkoutId);

    if (result.data?.code === "FORTER_DECLINE" && result.data?.retryable) {
      await editOrder(checkoutId, { cartcode: "pool" });
    }

    if (!result.ok) {
      await sendError(interaction, {
        title: "Order Confirmation Failed",
        description: result.message,
        footer: "Your order has not been marked as confirmed.",
      });
      return;
    }

    const data = result.data;
    const orderTotalCents = dollarsToCents(data.price.total);

    const remainingBalance = await deductBalance(
      discordUserId,
      orderTotalCents,
    );

    if (remainingBalance === null) {
      console.error(
        `[RECONCILIATION REQUIRED] Provider confirmed order ${data.order_id}, but wallet deduction failed. Checkout: ${checkoutId}`,
      );

      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "Your order has been confirmed by the provider, but the wallet payment could not be recorded. Support must review this order.",
        footer: `Checkout ID: ${checkoutId}`,
      });

      return;
    }

    try {
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          discordUserId,
          status: "pending",
          confirming: true,
        },
        {
          $set: {
            status: "confirmed",
            confirming: false,
            orderId: data.order_id,
            trackingUrl: data.tracking,
            total: data.price.total,
            expiresAt: null,
          },
        },
        {
          returnDocument: "after",
          upsert: false,
        },
      ).exec();

      if (!updatedOrder) {
        console.error(
          `[RECONCILIATION REQUIRED] Provider order ${data.order_id} is confirmed and wallet was debited, but the local order record was not updated. Checkout: ${checkoutId}`,
        );
      }
    } catch (error) {
      console.error(
        `[RECONCILIATION REQUIRED] Provider order ${data.order_id} is confirmed and wallet was debited, but the local DB update failed. Checkout: ${checkoutId}`,
        error,
      );
    }

    const panel = createConfirmedOrderPanel({ order: data });
    await interaction.followUp(panel);

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
  } finally {
    if (claimedOrderId) {
      await Order.updateOne(
        {
          _id: claimedOrderId,
          status: "pending",
          confirming: true,
        },
        {
          $set: { confirming: false },
        },
      ).catch((error) => {
        console.error("Failed to release confirmation lock:", error);
      });
    }
  }
}
