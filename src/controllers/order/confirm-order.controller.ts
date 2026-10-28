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
  calculateDiscountedOrderPrice,
  centsToDollars,
  dollarsToCents,
} from "../../utils/util.js";
import { logSuccess, logError, sendErrorAndLog } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { discountPercentage } from "../../constants/constant.js";
import { decrypt } from "../../utils/encryption.js";
import { sendLoading } from "../../ui/utils/sendLoading.js";

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
  let providerConfirmed = false;

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
      const card = await Card.findOne({
        isLocked: false,
        status: "active",
      }).sort({ isPin: -1 });

      if (!card) {
        await sendError(interaction, {
          title: "No Cards Available",
          description:
            "No payment methods are currently available. Our team is working on adding more cards. Please try again later.",
          footer: "Please wait until more cards become available.",
        });

        await logError(
          interaction.client,
          "No Cards Available",
          "No active cards are available. New cards need to be added to restore order processing.",
          {
            User: interaction.user.id,
            Action: "Add new cards",
            Status: "No active cards available",
          },
        );

        return;
      }

      await editOrder(checkoutId, {
        card: `${decrypt(card.encryptedCardNumber)},${card.expiryDate},${decrypt(card.encryptedCardCvv)},${card.zipcode}`,
      });
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
    providerConfirmed = true;

    try {
      await Card.findOneAndUpdate(
        { _id: order.card?._id },
        { $set: { isLocked: false } },
      );
    } catch (error) {
      console.error("Failed to unlock card after order confirmation:", error);
      await logError(interaction.client, "Card Unlock Failed", error, {
        User: discordUserId,
        "Checkout ID": checkoutId,
        "Order ID": data.order_id,
      });
    }

    let discountedPrice: ReturnType<typeof calculateDiscountedOrderPrice>;
    try {
      discountedPrice = calculateDiscountedOrderPrice(
        {
          subtotal: data.price.subtotal,
          service: data.price.service,
          delivery: data.price.delivery,
        },
        discountPercentage,
      );
    } catch (error) {
      const reconciliationError = `Provider confirmed order ${data.order_id}, but its customer price could not be calculated.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        error,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
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

    if (!Number.isFinite(calculatedTotal) || calculatedTotal <= 0) {
      const reconciliationError = `Provider confirmed order ${data.order_id}, but its calculated customer total is invalid: $${calculatedTotal}.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationError,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
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

    const orderTotalCents = dollarsToCents(calculatedTotal);
    if (dollarsToCents(order.total) !== orderTotalCents) {
      const reconciliationError = `Provider-confirmed total for order ${data.order_id} differs from the checkout amount. Checkout: $${order.total.toFixed(2)}, confirmed: $${calculatedTotal.toFixed(2)}.`;

      await logError(
        interaction.client,
        "Payment Reconciliation Required",
        reconciliationError,
        {
          User: discordUserId,
          "Checkout ID": checkoutId,
          "Order ID": data.order_id,
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
          Total: `$${calculatedTotal.toFixed(2)}`,
        },
      );
      console.error(`[RECONCILIATION REQUIRED] ${reconciliationMessage}`);
    }

    await logSuccess(
      interaction.client,
      "Order Confirmed",
      remainingBalance === null
        ? "Order confirmed; wallet deduction requires reconciliation."
        : "Order confirmed and wallet balance deducted.",
      {
        User: discordUserId,
        "Checkout ID": checkoutId,
        "Order ID": data.order_id,
        Total: `$${calculatedTotal.toFixed(2)}`,
      },
    );

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
            total: calculatedTotal,
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

        console.error(`[RECONCILIATION REQUIRED] ${reconciliationError}`);
        await logError(
          interaction.client,
          "Order Reconciliation Required",
          reconciliationError,
          {
            User: discordUserId,
            "Checkout ID": checkoutId,
            "Order ID": data.order_id,
            Total: `$${calculatedTotal.toFixed(2)}`,
          },
        );
      }
    } catch (error) {
      console.error(
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
          Total: `$${calculatedTotal.toFixed(2)}`,
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

    const panel = createConfirmedOrderPanel({
      order: { ...data, total: calculatedTotal },
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

    setTimeout(async () => {
      handleCreateAccount(interaction);
    }, 5_000);
  } catch (error) {
    await logError(interaction.client, "Order Confirmation Error", error, {
      User: interaction.user.id,
    });

    console.error("Failed to confirm order:", error);

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
        console.error("Failed to release confirmation lock:", error);
      });
    }
  }
}
