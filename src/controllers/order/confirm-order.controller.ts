import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import { randomUUID } from "node:crypto";
import {
  accountConfigure,
  getJobStatus,
} from "../../services/account.service.js";
import { UserChain } from "../../models/userChain.model.js";
import { Order } from "../../models/order.model.js";
import { confirmOrder } from "../../services/order.service.js";
import { createConfirmedOrderPanel } from "../../ui/order/createConfirmedOrderPanel.js";
import { sendError } from "../../ui/utils/sendError.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../../utils/error-handler.js";
import {
  deductBalanceOnce,
  getBalance,
} from "../../services/balance.service.js";
import {
  calculateDiscountedOrderPrice,
  centsToDollars,
  dollarsToCents,
} from "../../utils/util.js";
import { logSuccess, logError } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { releaseCardLockIfUnused } from "../../services/card.service.js";
import {
  classifyProviderConfirmation,
  createPendingOrderClaimFilter,
} from "../../services/order-confirmation-state.js";
import { sendLoading } from "../../ui/utils/sendLoading.js";
import { env } from "../../config/env.js";

async function handleCreateAccount(interaction: ButtonInteraction) {
  try {
    const oldChain = await UserChain.findOne()
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    let lastChain = oldChain?.lastChain || "1";
    let count = 1;

    if (oldChain) {
      const chainAccounts = await UserChain.countDocuments({ lastChain });

      if (chainAccounts >= env.maxChainAccounts) {
        const parsedChain = Number(lastChain);
        lastChain = String(Number.isFinite(parsedChain) ? parsedChain + 1 : 1);
        count = 3;
      }
    }

    const account = await accountConfigure({
      count,
      chain: lastChain,
    });

    if (!account.ok) {
      throw new Error("Failed to create account. Please try again later.");
    }

    if (account.state === "queued") {
      let accountStatus = await getJobStatus(account.job);

      while (!accountStatus.done) {
        if (!accountStatus.ok) {
          throw new Error("Failed to fetch account status.");
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        accountStatus = await getJobStatus(account.job);
      }
    }

    await UserChain.create({ lastChain });

    if (count === 3) {
      await logSuccess(
        interaction.client,
        "New Chain Created",
        `A new account chain (${lastChain}) was created with ${count} accounts.`,
        {
          "Chain ID": lastChain,
          "Accounts Created": String(count),
        },
      );
    }
  } catch (error) {
    console.error("Account creation failed:", error);

    await logError(interaction.client, "Account Creation Failed", error, {
      User: interaction.user.id,
      Action: "Create Next Account",
      Status: "Failed",
    });
  }
}

export async function handleConfirmOrder(interaction: ButtonInteraction) {
  let claimedOrderId: typeof Order.prototype._id | null = null;
  let claimedOrderExpiresAt: Date | null = null;
  let confirmationToken: string | null = null;
  let providerRequestStarted = false;

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
          {
            returnDocument: "after",
            upsert: false,
          },
        )
          .populate("card", "_id last4Digits expiryDate status")
          .exec()
      : null;

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
          confirmationState: "provider_requested",
          confirmationStartedAt: new Date(),
        },
      },
    );

    if (requestStarted.matchedCount !== 1) {
      throw new Error(
        "The confirmation lock was lost before provider request.",
      );
    }

    providerRequestStarted = true;
    const result = await confirmOrder(checkoutId);
    const providerData =
      result.ok && typeof result.data === "object" && result.data !== null
        ? (result.data as Record<string, unknown>)
        : {};
    const providerOutcome = classifyProviderConfirmation(
      result.ok,
      providerData,
    );
    const providerOrderId =
      typeof providerData.order_id === "string" ? providerData.order_id : null;

    if (providerOutcome === "declined") {
      let cardBlocked = false;
      try {
        if (order.card?._id) {
          await Card.updateOne(
            { _id: order.card._id },
            { $set: { status: "blocked" } },
          );
          cardBlocked = true;
        }
      } catch (error) {
        await logError(interaction.client, "Card Block Failed", error, {
          User: discordUserId,
          "Checkout ID": checkoutId,
        });
      }

      const declinedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: "pending",
          confirming: true,
          confirmationToken,
        },
        {
          $set: {
            status: order.card?._id && !cardBlocked ? "unknown" : "failed",
            confirming: false,
            confirmationState:
              order.card?._id && !cardBlocked ? "unknown" : null,
            confirmationToken: null,
            confirmationStartedAt: null,
            confirmationExpiresAt: null,
            expiresAt: null,
          },
        },
        { returnDocument: "after", upsert: false },
      ).exec();

      if (declinedOrder && cardBlocked) {
        try {
          await releaseCardLockIfUnused(order.card?._id);
        } catch (error) {
          await logError(interaction.client, "Card Unlock Failed", error, {
            User: discordUserId,
            "Checkout ID": checkoutId,
          });
        }
      }

      await logError(
        interaction.client,
        "Order Confirmation Failed",
        "The provider declined the payment method. No alternate card was used.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
        },
      );
      await sendError(interaction, {
        title: "Order Confirmation Failed",
        description:
          "The provider declined this payment method. The checkout will not be retried with another card.",
        footer: "Please contact support before creating another checkout.",
        ephemeral: false,
      });
      return;
    }

    if (providerOutcome === "uncertain") {
      const uncertaintyReason = result.ok
        ? "The provider returned an unusable confirmation response."
        : result.message;

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
        "Provider Confirmation Requires Reconciliation",
        `${uncertaintyReason} The provider response for checkout ${checkoutId} was not definitive. No further confirmation request will be sent.`,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );
      await sendError(interaction, {
        title: "Order Status Uncertain",
        description:
          "The provider did not return a definitive confirmation result. To avoid a duplicate order, this checkout cannot be retried automatically. Support has been notified.",
        footer: "Please contact support before attempting another checkout.",
        ephemeral: false,
      });
      return;
    }

    const providerPrice =
      typeof providerData.price === "object" && providerData.price !== null
        ? (providerData.price as Record<string, unknown>)
        : {};
    const providerTracking =
      typeof providerData.tracking === "string" ? providerData.tracking : null;
    const providerCost =
      typeof providerPrice.total === "number" &&
      Number.isFinite(providerPrice.total)
        ? providerPrice.total
        : order.cost;

    let persistedConfirmation;
    try {
      persistedConfirmation = await Order.findOneAndUpdate(
        {
          _id: order._id,
          discordUserId,
          status: "pending",
          confirming: true,
          confirmationToken,
        },
        {
          $set: {
            status: "confirmed",
            confirming: false,
            confirmationState: "provider_confirmed",
            confirmationToken: null,
            confirmationStartedAt: null,
            confirmationExpiresAt: null,
            orderId: providerOrderId,
            cost: providerCost,
            trackingUrl: providerTracking,
            total: order.total,
            paymentStatus: "reconciliation_required",
            expiresAt: null,
          },
        },
        { returnDocument: "after", upsert: false },
      ).exec();
    } catch (error) {
      await logError(
        interaction.client,
        "Order Database Update Failed",
        error,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "The provider confirmed your order, but local status could not be verified. No wallet payment was taken. Support has been notified.",
        footer: "Please contact support before attempting another payment.",
        ephemeral: false,
      });
      return;
    }

    if (!persistedConfirmation) {
      const message = `Provider confirmation for checkout ${checkoutId} succeeded, but its local order state could not be claimed for persistence. Wallet payment was not attempted.`;
      await logError(
        interaction.client,
        "Order Reconciliation Required",
        message,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "The provider confirmed your order, but local status could not be verified. No wallet payment was taken. Support has been notified.",
        footer: "Please contact support before attempting another payment.",
        ephemeral: false,
      });
      return;
    }

    try {
      await releaseCardLockIfUnused(order.card?._id);
    } catch (error) {
      await logError(interaction.client, "Card Unlock Failed", error, {
        User: discordUserId,
        "Checkout ID": checkoutId,
        ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
      });
    }

    if (!providerTracking) {
      await logError(
        interaction.client,
        "Order Tracking Missing",
        new Error("Tracking information is missing for this order."),
        {
          "Order ID": providerOrderId ?? checkoutId,
          User: interaction.user.id,
          Status: "Tracking Unavailable",
        },
      );
    }

    if (!providerOrderId) {
      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        "The provider confirmed the checkout but did not return an order ID. Wallet payment was not taken.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "Your order was confirmed, but the provider did not return tracking details needed to verify it. No wallet payment was taken. Support has been notified.",
        footer: "Please contact support before attempting another payment.",
        ephemeral: false,
      });
      return;
    }

    let discountedPrice: ReturnType<typeof calculateDiscountedOrderPrice>;
    try {
      discountedPrice = calculateDiscountedOrderPrice(
        {
          subtotal:
            typeof providerPrice.subtotal === "number"
              ? providerPrice.subtotal
              : Number.NaN,
          service:
            typeof providerPrice.service === "number"
              ? providerPrice.service
              : Number.NaN,
          delivery:
            typeof providerPrice.delivery === "number"
              ? providerPrice.delivery
              : Number.NaN,
        },
        order.discountPercentage,
      );
    } catch (error) {
      const reconciliationError = `Provider confirmed order ${providerOrderId ?? checkoutId}, but its customer price could not be calculated.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        error,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
          Error: reconciliationError,
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "Your order was confirmed, but its final total could not be calculated. Support has been notified; no wallet payment was taken.",
        footer: "Please contact support before attempting another payment.",
        ephemeral: false,
      });
      return;
    }

    const calculatedTotal = discountedPrice.total;

    if (!Number.isFinite(calculatedTotal) || calculatedTotal < 0) {
      const reconciliationError = `Provider confirmed order ${providerOrderId ?? checkoutId}, but its calculated customer total is invalid: $${calculatedTotal}.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationError,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
          "Calculated Total": String(calculatedTotal),
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "Your order was confirmed, but its final total could not be calculated. Support has been notified.",
        footer: "Please contact support before retrying payment.",
        ephemeral: false,
      });
      return;
    }

    const calculatedTotalCents = dollarsToCents(calculatedTotal);
    const expectedTotalCents = dollarsToCents(order.total);
    if (expectedTotalCents !== calculatedTotalCents) {
      const reconciliationError = `Provider-confirmed total for order ${providerOrderId ?? checkoutId} differs from the checkout amount. Checkout: $${order.total.toFixed(2)}, confirmed: $${calculatedTotal.toFixed(2)}.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationError,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
          "Checkout Total": `$${order.total.toFixed(2)}`,
          "Confirmed Total": `$${calculatedTotal.toFixed(2)}`,
        },
      );
      await sendError(interaction, {
        title: "Payment Reconciliation Required",
        description:
          "The confirmed order price differs from the checkout price. Support has been notified and no wallet payment was taken.",
        footer: "Please contact support before attempting another payment.",
        ephemeral: false,
      });
      return;
    }

    let remainingBalance: bigint | null = null;
    let deductionError: unknown;

    try {
      const deduction = await deductBalanceOnce(
        discordUserId,
        expectedTotalCents,
        checkoutId,
      );
      if (deduction.ok) {
        remainingBalance = deduction.remainingBalance;
      } else {
        deductionError = new Error(
          deduction.reason === "missing"
            ? "Wallet account was not found."
            : "Wallet balance changed before payment could be deducted.",
        );
      }
    } catch (error) {
      deductionError = error;
    }

    if (remainingBalance === null) {
      const reconciliationMessage = deductionError
        ? `Provider confirmed order ${providerOrderId ?? checkoutId}, but wallet deduction failed: ${String(deductionError)}`
        : `Provider confirmed order ${providerOrderId ?? checkoutId}, but wallet deduction failed.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationMessage,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
          Total: `$${order.total.toFixed(2)}`,
        },
      );
    } else {
      try {
        const paymentUpdated = await Order.updateOne(
          {
            _id: order._id,
            status: "confirmed",
            paymentStatus: "reconciliation_required",
          },
          { $set: { paymentStatus: "paid" } },
        );
        if (paymentUpdated.matchedCount !== 1) {
          await logError(
            interaction.client,
            "Wallet Payment Reconciliation Required",
            "Wallet deduction succeeded, but the local payment status was not updated.",
            {
              User: discordUserId,
              "Checkout ID": checkoutId,
              "Order ID": providerOrderId,
            },
          );
        }
      } catch (error) {
        await logError(
          interaction.client,
          "Wallet Payment Reconciliation Required",
          error,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
          },
        );
      }
    }

    await logSuccess(
      interaction.client,
      "Order Completed Successfully",
      [
        providerTracking
          ? [
              "<a:FoodDeliverybike1:1564011957105856513>  Track Your Order",
              `[View Live Tracking →](${providerTracking}) \n`,
            ].join("          ")
          : "Tracking information is currently unavailable.\n",
      ].join("\n"),
      {
        Customer: `<@${discordUserId}>`,
        "Checkout ID": checkoutId,
        "Payment Status":
          remainingBalance === null
            ? "Reconciliation Required"
            : "Successfully Deducted",
      },
    );

    const restaurant =
      typeof providerData.restaurant === "string"
        ? providerData.restaurant
        : "your restaurant";
    const panel = createConfirmedOrderPanel({
      order: {
        id: providerOrderId ?? checkoutId,
        status:
          typeof providerData.status === "string"
            ? providerData.status
            : "confirmed",
        tracking: providerTracking,
        restaurant,
        total: order.total,
      },
    });

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
      try {
        await channel.setName(
          `✅-order-${displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
        );
      } catch (error) {
        await logError(
          interaction.client,
          "Order Ticket Rename Failed",
          error,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
          },
        );
      }
    }

    try {
      await UserChain.findOneAndUpdate(
        { discordId: null },
        { discordId: interaction.user.id },
        { sort: { createdAt: -1 } },
      );
    } catch {}

    setTimeout(() => {
      void handleCreateAccount(interaction);
    }, 5_000);
  } catch (error) {
    await logError(interaction.client, "Order Confirmation Error", error, {
      User: interaction.user.id,
    });

    console.error("Failed to confirm order:", error);

    await handleInteractionError(interaction, error, "Failed to confirm order");
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
          "Failed to Release Confirmation Lock",
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
