import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import {
  accountConfigure,
  getJobStatus,
} from "../../services/account.service.js";
import { UserChain } from "../../models/userChain.model.js";
import { Order } from "../../models/order.model.js";
import { confirmOrder, editOrder } from "../../services/order.service.js";
import { createConfirmedOrderPanel } from "../../ui/order/createConfirmedOrderPanel.js";
import { sendError } from "../../ui/utils/sendError.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../../utils/error-handler.js";
import { deductBalance, getBalance } from "../../services/balance.service.js";
import {
  calculateOrderTotal,
  centsToDollars,
  dollarsToCents,
} from "../../utils/util.js";
import { logSuccess, logError, sendErrorAndLog } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";

async function handleCreateAccount(interaction: ButtonInteraction) {
  try {
    const oldChain = await UserChain.findOne()
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    let lastChain = oldChain?.lastChain || "1";

    const account = await accountConfigure({ count: 1, chain: lastChain });

    if (!account.ok) {
      throw new Error("Failed to create account Please try again later");
    }

    if (account.state === "queued") {
      let accountStatus = await getJobStatus(account.job);

      if (!accountStatus.ok && !accountStatus.retryable) {
        throw new Error(
          "Failed to fetch account status Please try again later",
        );
      }

      while (!accountStatus.done) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        accountStatus = await getJobStatus(account.job);

        if (!accountStatus.ok) {
          throw new Error(
            "Failed to fetch account status Please try again later",
          );
        }
      }
    }

    await UserChain.create({ lastChain });
  } catch (error) {
    await sendErrorAndLog(
      interaction,
      "Account Creation Failed",
      "Failed to create the next account.",
      "Security Log • Account Creation",
      error,
      {
        Action: "Create Next Account",
        Status: "Failed",
      },
    );
  }
}

export async function handleConfirmOrder(interaction: ButtonInteraction) {
  let claimedOrderId: typeof Order.prototype._id | null = null;

  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply(),
    );

    const checkoutId = interaction.customId.split(":")[2];
    const discordUserId = interaction.user.id;

    if (!checkoutId) {
      await sendError(interaction, {
        title: "Invalid Checkout",
        description: "The checkout ID is missing or invalid.",
        footer: "Please try again or contact support.",
        ephemeral: false,
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
    )
      .populate("card", "_id last4Digits expiryDate status")
      .exec();

    if (!order) {
      await sendError(interaction, {
        title: "Order Not Available",
        description:
          "This order is already being confirmed or is no longer pending.",
        footer: "Please check your order status and try again.",
        ephemeral: false,
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
        ephemeral: false,
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
        ephemeral: false,
      });
      return;
    }

    const result = await confirmOrder(checkoutId);

    if (result.data?.code === "FORTER_DECLINE" && result.data?.retryable) {
      await editOrder(checkoutId, { card: "pool" });
    }

    if (!result.ok) {
      await logError(
        interaction.client,
        "Order Confirmation Failed",
        result.message,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );

      await sendError(interaction, {
        title: "Order Confirmation Failed",
        description: result.message,
        footer: "Your order has not been marked as confirmed.",
        ephemeral: false,
      });

      return;
    }

    const data = result.data;

    const calculatedTotal = calculateOrderTotal({
      subtotal: data.price.subtotal,
      referral: data.price.referral,
      service: data.price.service,
      delivery: data.price.delivery,
      tax: data.price.tax,
      tip: data.price.tip,
      credit: data.price.credit,
    });

    const orderTotalCents = dollarsToCents(calculatedTotal);

    const remainingBalance = await deductBalance(
      discordUserId,
      orderTotalCents,
    );

    if (remainingBalance === null) {
      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        `Provider confirmed order ${data.order_id}, but wallet deduction failed.`,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
        },
      );
      console.error(
        `[RECONCILIATION REQUIRED] Provider confirmed order ${data.order_id}, but wallet deduction failed. Checkout: ${checkoutId}`,
      );
    }

    await logSuccess(
      interaction.client,
      "Order Confirmed",
      "Order confirmed and wallet balance deducted.",
      {
        User: discordUserId,
        "Checkout ID": checkoutId,
        "Order ID": data.order_id,
        Total: `$${data.price.total}`,
      },
    );

    try {
      await Card.findOneAndUpdate(
        { _id: order.card?._id },
        { $set: { isLocked: false } },
      );

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
        const reconciliationError = `Provider order ${data.order_id} is confirmed and wallet was debited, but the local order record was not updated. Checkout: ${checkoutId}`;

        console.error(`[RECONCILIATION REQUIRED] ${reconciliationError}`);

        await logError(
          interaction.client,
          "Order Reconciliation Required",
          reconciliationError,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            "Order ID": data.order_id,
          },
        );
      }
    } catch (error) {
      console.error(
        `[RECONCILIATION REQUIRED] Provider order ${data.order_id} is confirmed and wallet was debited, but the local DB update failed. Checkout: ${checkoutId}`,
        error,
      );

      await logError(
        interaction.client,
        "Order Database Update Failed",
        error,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
        },
      );
    }

    if (!data.tracking) {
      await logError(
        interaction.client,
        "Order Tracking Missing",
        new Error("Tracking information is missing for this order."),
        {
          "Order ID": String(data.id),
          User: interaction.user.id,
          Status: "Tracking Unavailable",
        },
      );
    }

    const panel = createConfirmedOrderPanel({ order: data });

    await attemptInteractionResponse(interaction, () =>
      interaction.followUp({
        ...panel,
        flags: MessageFlags.IsComponentsV2,
      }),
    );

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

    try {
      await UserChain.findOneAndUpdate(
        { discordId: null },
        { $set: { discordId: interaction.user.id } },
        { sort: { createdAt: -1 } },
      );
    } catch {}

    setTimeout( async () => {
       handleCreateAccount(interaction);
    }, 5_000);
  } catch (error) {
    await logError(interaction.client, "Order Confirmation Error", error, {
      User: interaction.user.id,
    });

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
