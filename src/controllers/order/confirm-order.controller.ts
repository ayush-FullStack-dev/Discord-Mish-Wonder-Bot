import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import mongoose from "mongoose";
import { createAccountsOnChain } from "../../services/account.service.js";
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
import { centsToDollars, dollarsToCents } from "../../utils/util.js";
import { logSuccess, logError, logOrderSuccess } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { sendLoading } from "../../ui/utils/sendLoading.js";
import {
  ADMIN_USERID,
  maxPaymentAttempts,
  minChainAccountCount,
} from "../../constants/constant.js";
import { getBestChain } from "../../utils/chain.js";
import { errorLog } from "../../../logs/printLogs.js";
import { repriceAndUpdateOrder } from "../../utils/repriceCheckout.js";
import { updateOrderChannel } from "../../utils/discord.js";
import {
  blockDeclinedCard,
  selectReplacementCard,
  updateOrderPaymentCard,
  unlockReplacementCard,
  getReplacementCardDetails,
  updateCheckoutForRetry,
} from "./confirm-order-recovery.js";

async function handleCreateAccount(interaction: ButtonInteraction) {
  try {
    const chainId = await getBestChain("most_unused_credit");

    const chainAccounts = await UserChain.countDocuments({
      lastChain: chainId,
    });

    const count =
      chainId === "1" ? 1 : Math.max(1, minChainAccountCount - chainAccounts);

    const result = await createAccountsOnChain({
      chain: chainId,
      count,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    await UserChain.create({
      lastChain: chainId,
    });

    const isNewChain = count === 3;

    return logSuccess(
      interaction.client,
      isNewChain ? "New Chain Created" : "Chain Updated",
      isNewChain
        ? `A new account chain (${chainId}) was created with ${count} accounts.`
        : `${count} account(s) added to chain (${chainId}).`,
      {
        "Chain ID": chainId,
        "Accounts Created": String(count),
      },
    );
  } catch (error) {
    errorLog("Account creation failed:", error);

    return logError(interaction.client, "Account Creation Failed", error, {
      User: interaction.user.id,
      Action: "Create Next Account",
      Status: "Failed",
    });
  }
}

export async function handleConfirmOrder(interaction: ButtonInteraction) {
  let claimedOrderId: typeof Order.prototype._id | null = null;
  let providerConfirmed = false;
  let paymentAttempts = 0;
  const repriceInterval = 3;
  const attemptedCardIds = new Set<string>();

  const displayName =
    interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : (interaction.user.globalName ?? interaction.user.username);

  const channelName = `order-${displayName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 85)}`;

  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply(),
    );

    await sendLoading(interaction, {
      title: "Confirming Your Order",
      description: [
        "**Processing Order Confirmation**",
        "",
        "Confirming your order with the provider and processing your wallet payment...",
        "Please wait while we complete the process.",
      ].join("\n"),
      footer: "Do not click confirm again while your order is processing.",
      ephemeral: false,
    });

    const orderId = interaction.customId.split(":")[2];
    const discordUserId = interaction.user.id;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      await sendError(interaction, {
        title: "Invalid Order",
        description: "The order ID is missing or invalid.",
        footer: "Please try again or contact support.",
        ephemeral: false,
      });
      return;
    }

    let order = await Order.findOneAndUpdate(
      {
        _id: orderId,
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
        title: "Order Unavailable",
        description: [
          "This order is no longer available in our system.",
          "",
          "**Please place a new order using the same cart code or a different one.**",
        ].join("\n"),
        footer: "This order is no longer associated with your account.",
        ephemeral: false,
      });
      return;
    }

    claimedOrderId = order._id;

    if (
      order.discordUserId !== discordUserId &&
      !ADMIN_USERID.includes(discordUserId)
    ) {
      return sendError(interaction, {
        title: "Unauthorized Access",
        description: "You are not authorized to confirm this order.",
        footer: "Only the order owner or an admin can confirm it.",
        ephemeral: true,
      });
    } else if (order.status !== "pending") {
      const statusMessages = {
        confirmed: "This order has already been confirmed successfully.",
        failed: "This order has failed and cannot be confirmed again.",
        cancelled: "This order has been cancelled and is no longer available.",
        unknown: "We couldn't verify the status of this order.",
      } as const;

      const description =
        statusMessages[order.status as keyof typeof statusMessages] ??
        "This order cannot be confirmed at the moment.";

      await sendError(interaction, {
        title: "Order Cannot Be Confirmed",
        description,
        footer: "Please place a new order to continue.",
        ephemeral: false,
      });

      return;
    }

    let checkoutId = order.checkoutId;

    if (typeof checkoutId !== "string" || !checkoutId.trim()) {
      await sendError(interaction, {
        title: "Checkout Unavailable",
        description: "The checkout ID for this order is unavailable.",
        footer: "Please contact support before trying again.",
        ephemeral: false,
      });
      return;
    }

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

    if (
      typeof order.discountPercentage !== "number" ||
      !Number.isFinite(order.discountPercentage) ||
      order.discountPercentage < 0 ||
      order.discountPercentage > 100 ||
      !Number.isFinite(order.total) ||
      order.total < 0
    ) {
      await sendError(interaction, {
        title: "Checkout Pricing Unavailable",
        description:
          "This pending order does not contain verifiable pricing details. Please create a new checkout or contact support.",
        footer: "No payment has been taken.",
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

    let activeCardId = order.card?._id;

    if (activeCardId) {
      attemptedCardIds.add(activeCardId.toString());
    }

    await updateOrderChannel(interaction, `🔄-${channelName}`);

    try {
      const repriced = await repriceAndUpdateOrder({
        interaction,
        checkoutId,
        orderId: claimedOrderId,
      });

      checkoutId = repriced.checkoutId;
      order = repriced.order;
    } catch (error) {
      errorLog("Initial checkout reprice failed:", error);
    }

    let result = await confirmOrder(checkoutId);

    const retryLoadingOptions = {
      title: "Trying Another Payment Method",
      description: [
        "**Your payment couldn't be processed with the current card.**",
        "",
        "We're trying another available payment method to complete your order.",
        "Please wait while we process your confirmation.",
      ].join("\n"),
      footer: "You don't need to confirm your order again.",
      ephemeral: false,
    };

    if (result.code === "PAYMENT_ERROR") {
      try {
        await logError(
          interaction.client,
          "Payment Retry Started",
          "The initial payment method was declined during order confirmation. Attempting alternative payment methods.",
          {
            User: interaction.user.id,
            "Checkout ID": checkoutId,
            "Maximum Attempts": String(maxPaymentAttempts),
          },
        );

        await sendLoading(interaction, retryLoadingOptions);
      } catch (error) {
        errorLog("Failed to send payment retry notification:", error);
      }
    }

    while (
      result.code === "PAYMENT_ERROR" &&
      paymentAttempts < maxPaymentAttempts
    ) {
      paymentAttempts++;
      const confirmFailed = result.code === "PAYMENT_ERROR";
      await blockDeclinedCard(activeCardId);

      const newCard = await selectReplacementCard(attemptedCardIds);

      if (!newCard) {
        await logError(
          interaction.client,
          "No Cards Available",
          "No active payment methods are available for another confirmation attempt.",
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            "Failed Attempts": String(paymentAttempts),
          },
        );

        await sendError(interaction, {
          title: "No Payment Methods Available",
          description:
            "This order cannot be confirmed right now because our system has no available cards.",
          footer:
            "Please wait until an admin adds new cards before trying again.",
          ephemeral: false,
        });

        await updateOrderChannel(interaction, `⚠️-${channelName}`);
        return;
      }

      attemptedCardIds.add(newCard._id.toString());
      activeCardId = newCard._id;

      const updatedOrder = await updateOrderPaymentCard(
        claimedOrderId!,
        newCard._id,
      );

      if (!updatedOrder) {
        await unlockReplacementCard(newCard._id);

        result = {
          ok: false,
          code: "ORDER_UPDATE_FAILED",
          message: "Failed to update the order payment method.",
        };

        break;
      }

      order = updatedOrder;
      const card = getReplacementCardDetails(newCard);
      const checkout = await updateCheckoutForRetry({
        interaction,
        checkoutId,
        orderId: order._id,
        card,
        paymentAttempts,
        repriceInterval,
        confirmFailed,
        restoreLoading: retryLoadingOptions,
      });

      if (!checkout.ok) {
        errorLog("[CHECKOUT_RECOVERY_FAILED]", checkout.message);

        await sendError(interaction, {
          title: "Checkout Recovery Failed",
          description: checkout.message,
          footer: "Please contact support if the issue persists.",
          ephemeral: false,
        });

        await updateOrderChannel(interaction, `⚠️-${channelName}`);
        return;
      }

      checkoutId = checkout.data.checkoutId;
      
      if (checkout.data.order) {
        order = checkout.data.order;
      }

      result = await confirmOrder(checkoutId);
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

      await updateOrderChannel(interaction, `⚠️-${channelName}`);
      return;
    }

    const data = result.data;
    providerConfirmed = true;

    try {
      await Card.findOneAndUpdate(
        { _id: activeCardId },
        { $set: { isLocked: false, lastUsedBy: discordUserId } },
      );
    } catch (error) {
      await logError(interaction.client, "Card Unlock Failed", error, {
        User: discordUserId,
        "Checkout ID": checkoutId,
        "Order ID": data.order_id,
      });
    }

    if (!order) {
      throw new Error("Order not found during confirmation.");
    }

    const expectedTotalCents = dollarsToCents(order.total);
    const validatedCustomerTotal = order.total;
    const orderTotalCents = expectedTotalCents;

    let remainingBalance: bigint | null = null;
    let deductionError: unknown;

    try {
      remainingBalance = await deductBalance(discordUserId, orderTotalCents);
    } catch (error) {
      deductionError = error;
    }

    if (remainingBalance === null) {
      const reconciliationMessage = deductionError
        ? `Provider confirmed order ${data.order_id}, but wallet deduction failed: ${String(deductionError)}`
        : `Provider confirmed order ${data.order_id}, but wallet deduction failed.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationMessage,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
          Total: `$${validatedCustomerTotal.toFixed(2)}`,
        },
      );

      errorLog(`[RECONCILIATION REQUIRED] ${reconciliationMessage}`);
    }

    if (!data.tracking) {
      errorLog("Tracking information is missing for this order", data);

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

    await logOrderSuccess(interaction.client, "Order Completed Successfully", {
      Customer: `<@${discordUserId}>`,
      "Checkout ID": checkoutId,
      "Payment Status":
        remainingBalance === null
          ? "Reconciliation Required"
          : "Successfully Deducted",
    });

    try {
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: claimedOrderId!,
          discordUserId,
          status: "pending",
          confirming: true,
        },
        {
          $set: {
            status: "confirmed",
            confirming: false,
            orderId: data.order_id,
            cost: data.price.total,
            trackingUrl: data.tracking,
            total: validatedCustomerTotal,
            expiresAt: null,
          },
        },
        {
          returnDocument: "after",
          upsert: false,
        },
      ).exec();

      if (!updatedOrder) {
        const reconciliationError = `Provider order ${data.order_id} is confirmed, but the local order record was not updated${
          remainingBalance === null ? "" : " after wallet deduction"
        }. Checkout: ${checkoutId}`;

        errorLog(`[RECONCILIATION REQUIRED] ${reconciliationError}`);

        await logError(
          interaction.client,
          "Order Reconciliation Required",
          reconciliationError,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            "Order ID": data.order_id,
            Total: `$${validatedCustomerTotal.toFixed(2)}`,
          },
        );
      }
    } catch (error) {
      errorLog(
        `[RECONCILIATION REQUIRED] Provider order ${data.order_id} is confirmed, but the local DB update failed${
          remainingBalance === null ? "" : " after wallet deduction"
        }. Checkout: ${checkoutId}`,
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
          Total: `$${validatedCustomerTotal.toFixed(2)}`,
        },
      );
    }

    const panel = createConfirmedOrderPanel({
      order: { ...data, total: validatedCustomerTotal },
    });

    await attemptInteractionResponse(interaction, () =>
      interaction.followUp({
        ...panel,
        flags: MessageFlags.IsComponentsV2,
      }),
    );

    const channel = interaction.channel;

    if (channel?.type === ChannelType.GuildText) {
      await updateOrderChannel(interaction, `✅-${channelName}`);
    }

    try {
      await UserChain.findOneAndUpdate(
        { discordId: null },
        { discordId: interaction.user.id },
        { sort: { createdAt: -1 } },
      );
    } catch {}

    setTimeout(async () => {
      handleCreateAccount(interaction);
    }, 5_000);
  } catch (error) {
    await logError(interaction.client, "Order Confirmation Error", error, {
      User: interaction.user.id,
    });

    errorLog("Failed to confirm order:", error);

    await updateOrderChannel(interaction, `⚠️-${channelName}`);
    await handleInteractionError(interaction, error, "Failed to confirm order");
  } finally {
    if (claimedOrderId && !providerConfirmed) {
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
        errorLog("Failed to release confirmation lock:", error);
      });
    }
  }
}
