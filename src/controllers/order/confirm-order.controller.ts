import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import { randomUUID } from "node:crypto";
import {
  accountConfigure,
  createAccountsOnChain,
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
  getProviderConfirmationDetails,
} from "../../services/order-confirmation.service.js";
import { sendLoading } from "../../ui/utils/sendLoading.js";
import { env } from "../../config/env.js";
import { minChainAccountCount } from "../../constants/constant.js";

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
        count = minChainAccountCount;
      }
    }

    const result = await createAccountsOnChain({
      chain: lastChain,
      count,
    });

    if (!result.ok) {
      throw new Error(result.error);
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

    const requestStarted = await Order.findOneAndUpdate(
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

    if (!requestStarted) {
      throw new Error(
        "The confirmation lock was lost before provider request.",
      );
    }

    providerRequestStarted = true;
    const result = await confirmOrder(checkoutId);
    const providerData =
      typeof result.data === "object" &&
      result.data !== null &&
      !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : {};
    const providerDetails = getProviderConfirmationDetails(result.data);
    const providerOutcome = classifyProviderConfirmation(
      result.ok,
      result.data,
    );
    const providerOrderId =
      typeof providerData.order_id === "string" &&
      providerData.order_id.trim().length > 0
        ? providerData.order_id
        : null;

    const orderReference = providerOrderId ?? checkoutId;

    if (providerOutcome === "declined") {
      const declinedCardStatus =
        providerDetails.code === "FORTER_DECLINE" ? "blocked" : "inactive";
      let declinedCardUpdated = false;
      let cardUpdateError: unknown;
      try {
        if (order.card?._id) {
          await Card.findByIdAndUpdate(order.card._id, {
            $set: {
              status: declinedCardStatus,
              isLocked: false,
            },
          });

          declinedCardUpdated = true;
        }
      } catch (error) {
        cardUpdateError = error;
      }

      let declinedOrderUpdated = false;
      try {
        const declinedOrder = await Order.updateOne(
          {
            _id: order._id,
            discordUserId,
            status: "pending",
            confirming: true,
            confirmationToken,
          },
          {
            $set: {
              status: "failed",
              confirming: false,
              confirmationState: null,
              confirmationToken: null,
              confirmationStartedAt: null,
              confirmationExpiresAt: null,
              expiresAt: null,
            },
          },
        );
        declinedOrderUpdated = declinedOrder.matchedCount === 1;
      } catch (error) {
        await logError(
          interaction.client,
          "Declined Order Persistence Failed",
          error,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            "Provider Outcome": providerOutcome,
          },
        );
      }

      await logError(
        interaction.client,
        "Order Confirmation Failed",
        cardUpdateError ??
          providerDetails.message ??
          "The provider declined the payment method.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Provider Error Code":
            providerDetails.code ?? (result.ok ? null : result.code) ?? "N/A",
          "Provider HTTP Status":
            result.status === undefined ? "unknown" : String(result.status),
          "Provider Outcome": providerOutcome,
          "Card Blocked":
            providerDetails.code === "FORTER_DECLINE"
              ? declinedCardUpdated
                ? "Yes"
                : "No"
              : "N/A",
          "Declined Card Updated": declinedCardUpdated ? "Yes" : "No",
          "Order State Updated": declinedOrderUpdated ? "Yes" : "No",
          "Alternate Card Selected": "No",
          ...(providerOrderId ? { "Order ID": providerOrderId } : {}),
        },
      );

      await sendError(interaction, {
        title: "Order Confirmation Failed",
        description: declinedCardUpdated
          ? "The provider declined this payment method. The declined card has been removed from use, and this checkout will not be retried with another card."
          : "The provider declined this payment method, but its card could not be safely updated. The checkout will not be retried; please contact support.",
        footer: "Please contact support before creating another checkout.",
        ephemeral: false,
      });
      return;
    }

    if (providerOutcome === "uncertain") {
      const uncertaintyReason =
        providerDetails.message ??
        (result.ok
          ? "The provider returned an unusable confirmation response."
          : result.message);

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
          "Provider Error Code":
            providerDetails.code ??
            (result.ok ? "N/A" : (result.transportCode ?? "N/A")),
          "Provider HTTP Status":
            result.status === undefined ? "unknown" : String(result.status),
          "Provider Outcome": providerOutcome,
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
      typeof providerData.tracking === "string" &&
      providerData.tracking.trim().length > 0
        ? providerData.tracking
        : null;
    const providerCost =
      typeof providerPrice.total === "number" &&
      Number.isFinite(providerPrice.total)
        ? providerPrice.total
        : order.cost;

    try {
      const message = `Provider confirmation for checkout ${checkoutId} succeeded, but its local order state could not be claimed for persistence. Wallet payment was not attempted.`;
      const persistedConfirmation = await Order.findOneAndUpdate(
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

      if (!persistedConfirmation) {
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
      }
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
    }

    try {
      await releaseCardLockIfUnused(order.card?._id, discordUserId);
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
        "The provider confirmed the checkout but did not return an order ID. The checkout ID will be used as the order reference.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
        },
      );
    }

    const discountedPrice = calculateDiscountedOrderPrice(
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

    const providerTotalCents = dollarsToCents(discountedPrice.total);
    const expectedTotalCents = dollarsToCents(order.total);

    if (expectedTotalCents !== providerTotalCents) {
      await logError(
        interaction.client,
        "Order Price Mismatch",
        "Provider-confirmed price differs from the database order total. Processing will continue using the database amount.",
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Checkout Total": String(order.total),
          "Confirmed Total": String(discountedPrice.total),
        },
      );
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
        id: orderReference,
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
