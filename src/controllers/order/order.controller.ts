import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type Message,
  type TextChannel,
} from "discord.js";
import { cancelOrder, createOrder } from "../../services/order.service.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../../utils/error-handler.js";
import { sendError } from "../../ui/utils/sendError.js";
import { sendLoading } from "../../ui/utils/sendLoading.js";
import { sendSuccess } from "../../ui/utils/sendSuccess.js";
import { createOrderTicket } from "../../helpers/createOrderTicket.js";
import { createCheckoutPanel } from "../../ui/order/createCheckoutPanel.js";
import type { CheckoutData } from "../../ui/order/createCheckoutPanel.js";
import { Order } from "../../models/order.model.js";
import {
  calculateDiscountedOrderPrice,
  centsToDollars,
  formatExpiryDate,
  getExpireIn,
  secondsToMilliseconds,
} from "../../utils/util.js";
import { getBalance } from "../../services/balance.service.js";
import { env } from "../../config/env.js";
import { requireAdmin } from "../../middleware.js";
import { logError, sendErrorAndLog } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { decrypt } from "../../utils/encryption.js";
import { maxPaymentAttempts } from "../../constants/constant.js";
import { getDiscountPercentage } from "../../services/discount.service.js";
import { sendOrderExpired } from "../../ui/order/sendOrderExpired.js";
import { ORDER_ERRORS } from "../../constants/errors.js";
import { repriceCheckout } from "../../utils/repriceCheckout.js";
import type { Types } from "mongoose";
import { errorLog } from "../../../logs/printLogs.js";
import {
  updateOrderChannel,
  updateTicketChannel,
} from "../../utils/discord.js";

type IOrder = {
  name: string;
  discordUserId: string;
  checkoutId: string;
  orderId: string | null;
  total: number;
  discountPercentage: number;
  confirming: boolean;
  expiresAt: Date;
  card: Types.ObjectId;
  cost: number;
  repriceCount: number;
  repricedAt: Date | null;
};

async function scheduleOrderExpiry(
  ticket: TextChannel,
  orderId: typeof Order.prototype._id,
  cardId: typeof Card.prototype._id,
  checkoutMessage: Message<boolean>,
  expiresIn: number,
): Promise<void> {
  const channelName = `⌛-${ticket.name.replace(/^[^\w]+-/, "")}`;

  const checkExpiry = async () => {
    const order = await Order.findById(orderId);

    if (!order) {
      await sendOrderExpired({
        replyTo: checkoutMessage,
        expiresIn,
      });
      await updateTicketChannel(ticket, channelName);
      return;
    }

    if (order.status !== "pending" || !order.expiresAt) return;

    const remainingTime = new Date(order.expiresAt).getTime() - Date.now();

    if (remainingTime > 0) {
      setTimeout(() => {
        void checkExpiry().catch(console.error);
      }, remainingTime + 10_000);

      return;
    }

    const deletedOrder = await Order.findOneAndDelete({
      _id: orderId,
      status: "pending",
      expiresAt: { $lte: new Date() },
    });

    if (!deletedOrder) return;

    const usingCard = await Order.findOne({
      card: cardId,
      status: "pending",
    });

    if (!usingCard) {
      await Card.findByIdAndUpdate(cardId, {
        $set: { isLocked: false },
      });
    }

    await sendOrderExpired({
      replyTo: checkoutMessage,
      expiresIn,
    });
    await updateTicketChannel(ticket, channelName);
  };

  const order = await Order.findById(orderId);

  if (!order || order.status !== "pending" || !order.expiresAt) return;

  const delay = Math.max(
    0,
    new Date(order.expiresAt).getTime() - Date.now() + 10_000,
  );

  setTimeout(() => {
    void checkExpiry().catch(console.error);
  }, delay);
}

export async function handleOrderModal(interaction: ModalSubmitInteraction) {
  let checkoutId = null;
  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );

  try {
    const cartCode = interaction.fields.getTextInputValue("cart_code").trim();
    let paymentAttempts = 0;
    const balance = await getBalance(interaction.user.id);
    if (balance === null || balance < 100) {
      return sendError(interaction, {
        title: "Insufficient Balance",
        description:
          "You must have at least $1 in your MishGPT wallet to start a checkout.",
        footer: "Deposit at least $1 into your MishGPT account and try again.",
      });
    }

    const pendingOrder = await Order.countDocuments({
      discordUserId: interaction.user.id,
      status: "pending",
    });

    if (pendingOrder >= 2) {
      await sendError(interaction, {
        title: "Pending Order Limit Reached",
        description: [
          `You already have ${pendingOrder} pending orders.`,
          "",
          "Please confirm or cancel your existing orders before creating another one.",
        ].join("\n"),
        footer: `You can have a maximum of 2 pending orders at a time.`,
      });

      return;
    }

    await sendLoading(interaction, {
      title: "Preparing Checkout",
      description: [
        "**Checking Cart & Restaurant Pricing**",
        "",
        "Validating your cart and preparing checkout details...",
      ].join("\n"),
      footer: "No order is placed until you confirm.",
    });

    let card = await Card.findOne({
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

    const appliedDiscountPercentage = await getDiscountPercentage();
    let result = await createOrder(
      {
        cartCode,
      },
      {
        cardNumber: decrypt(card.encryptedCardNumber),
        cvv: decrypt(card.encryptedCardCvv),
        expiryDate: card.expiryDate,
        zipcode: card.zipcode,
      },
    );

    if (result.code === "PAYMENT_ERROR") {
      await sendLoading(interaction, {
        title: "Trying Another Payment Method",
        description: [
          "**Your payment couldn't be processed with the current card.**",
          "",
          "We're securely trying another available payment method.",
          "Please wait while we attempt your checkout again.",
        ].join("\n"),
        footer: "You don't need to submit your cart again.",
      });

      await logError(
        interaction.client,
        "Payment Retry Started",
        "The initial payment method was declined. Attempting checkout with alternative payment methods.",
        {
          User: interaction.user.id,
          "Maximum Attempts": String(maxPaymentAttempts),
        },
      );
    }

    while (
      result.code === "PAYMENT_ERROR" &&
      paymentAttempts < maxPaymentAttempts
    ) {
      paymentAttempts++;

      await Card.findByIdAndUpdate(card?._id, {
        isLocked: false,
        status: "blocked",
      });

      if (paymentAttempts >= maxPaymentAttempts) {
        await sendError(interaction, {
          title: "Unable to Process Your Payment",
          description: [
            "We couldn't complete your checkout after trying multiple payment methods.",
            "",
            "All declined payment methods have been temporarily blocked.",
            "Please contact support for assistance.",
          ].join("\n"),
          footer: "No further payment attempts will be made.",
        });

        return await logError(
          interaction.client,
          "Payment Retry Limit Reached",
          "All payment attempts failed. Every declined card has been blocked.",
          {
            User: interaction.user.id,
            "Failed Attempts": String(paymentAttempts),
            Status: "Maximum payment attempts reached",
          },
        );
      }

      const newCard = await Card.findOne({
        isLocked: false,
        status: "active",
      }).sort({ isPin: -1 });

      if (!newCard) {
        await sendError(interaction, {
          title: "No Payment Methods Available",
          description:
            "We couldn't find another available payment method to complete your checkout. Please contact support.",
          footer: "Our team can help you complete your order.",
        });

        return await logError(
          interaction.client,
          "No Cards Available",
          "No active payment methods are available for another checkout attempt.",
          {
            User: interaction.user.id,
            "Failed Attempts": String(paymentAttempts),
            Status: "No active cards available",
          },
        );
      }

      card = newCard;
      result = await createOrder(
        {
          cartCode,
        },
        {
          cardNumber: decrypt(newCard.encryptedCardNumber),
          cvv: decrypt(newCard.encryptedCardCvv),
          expiryDate: newCard.expiryDate,
          zipcode: newCard.zipcode,
        },
      );
    }

    if (result.code !== null && result.code !== undefined) {
      if (
        [
          "NO_CARD",
          "CARD_REQUIRED",
          "UNAUTHORIZED",
          "UNKNOWN_ERROR",
          "CANNOT_PRICE",
        ].includes(result.code)
      ) {
        await logError(
          interaction.client,
          "Order Failed",
          result.message ?? result.code,
          {
            "Error Code": result.code,
            User: interaction.user.id,
          },
        );
      }

      const errorConfig = ORDER_ERRORS[result.code];

      await sendError(interaction, {
        title: errorConfig?.title ?? "Checkout Failed",
        description:
          result.message?.trim() ||
          errorConfig?.description ||
          "An unexpected error occurred.",
        footer: errorConfig?.footer ?? "Contact support if the issue persists.",
      });

      return;
    }

    if (!("data" in result)) {
      throw new Error("Checkout response did not contain data.");
    }

    const data = result.data;
    checkoutId = data.id;

    let discountedPrice: ReturnType<typeof calculateDiscountedOrderPrice>;
    try {
      discountedPrice = calculateDiscountedOrderPrice(
        {
          subtotal: data.price.subtotal,
          service: data.price.service,
          delivery: data.price.delivery,
        },
        appliedDiscountPercentage,
      );
    } catch (error) {
      let checkoutCancelled = false;
      try {
        const cancellation = await cancelOrder(checkoutId);
        checkoutCancelled = cancellation.ok;
        if (!cancellation.ok) {
          await logError(
            interaction.client,
            "Invalid Order Pricing Cancellation Failed",
            cancellation.message,
            {
              User: interaction.user.id,
              "Checkout ID": checkoutId,
            },
          );
        }
      } catch (cancellationError) {
        await logError(
          interaction.client,
          "Invalid Order Pricing Cancellation Failed",
          cancellationError,
          {
            User: interaction.user.id,
            "Checkout ID": checkoutId,
          },
        );
      }

      await sendErrorAndLog(
        interaction,
        "Invalid Order Pricing",
        "We couldn't calculate a valid customer total for this checkout.",
        checkoutCancelled
          ? "The checkout was cancelled. Please try again or contact support."
          : "The checkout could not be cancelled. Please do not confirm it; contact support.",
        error,
        {
          User: interaction.user.id,
          "Checkout ID": checkoutId,
        },
      );
      return;
    }

    const calculatedTotal = discountedPrice.total;

    if (data.price.subtotal < env.minimumOrderSubTotal) {
      const remainingAmount = (
        env.minimumOrderSubTotal - data.price.subtotal
      ).toFixed(2);

      try {
        await cancelOrder(checkoutId);
      } catch {
      } finally {
        return sendError(interaction, {
          title: "Minimum Order Not Met",
          description: `Your order total must be at least $${env.minimumOrderSubTotal}. Add another $${remainingAmount} to meet the minimum order requirement.`,
          footer: `Minimum order total: $${env.minimumOrderSubTotal}.`,
        });
      }
    } else if (data.price.subtotal > env.maxOrderSubTotal) {
      try {
        await cancelOrder(checkoutId);
      } catch {
      } finally {
        return sendError(interaction, {
          title: "Order Total Exceeds Limit",
          description: `The total amount of your order exceeds the maximum allowed limit of $${env.maxOrderSubTotal}.`,
          footer: `Please place an order with a total amount less than $${env.maxOrderSubTotal}.`,
        });
      }
    }

    const displayName =
      interaction.member instanceof GuildMember
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);
    let savedOrderId: typeof Order.prototype._id;
    let expiresAt = formatExpiryDate(data.expires_in);
    let updateConfig: IOrder = {
      name: displayName,
      discordUserId: interaction.user.id,
      checkoutId: checkoutId,
      orderId: data.order_id,
      total: calculatedTotal,
      discountPercentage: appliedDiscountPercentage,
      confirming: false,
      expiresAt,
      card: card._id,
      cost: data.price.total,
      repriceCount: 0,
      repricedAt: null,
    };

    try {
      const repriced = await repriceCheckout({
        interaction,
        checkoutId,
        restoreLoading: {
          title: "Saving Your Order",
          description: [
            "**Almost There!**",
            "",
            "Your checkout has been updated successfully.",
            "We're saving your order details. Please wait...",
          ].join("\n"),
          footer: "Please don't close this interaction.",
          ephemeral: false,
        },
      });
      expiresAt = formatExpiryDate(repriced.data.expires_in);
      checkoutId = repriced.checkoutId;

      updateConfig = {
        ...updateConfig,
        checkoutId: repriced.data.id,
        orderId: repriced.data.order_id,
        expiresAt,
        repricedAt: new Date(),
        repriceCount: 1,
      };

      const savedOrder = await Order.create(updateConfig);

      savedOrderId = savedOrder._id;
      await Card.findOneAndUpdate(
        { _id: card._id },
        { $set: { isLocked: true } },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      try {
        await cancelOrder(checkoutId);
      } catch (cancelError) {
        errorLog("Failed to cancel checkout:", cancelError);
      }

      await sendErrorAndLog(
        interaction,
        "Failed to Save Order",
        errorMessage,
        "Your order has been cancelled. Please try again later.",
        error,
        {
          "Order ID": String(checkoutId),
          User: interaction.user.id,
        },
      );

      return sendError(interaction, {
        title: "Failed to Save Order",
        description: `**Error:** ${errorMessage}`,
        footer: "Your order has been cancelled. Please try again later.",
      });
    }

    const checkoutData: CheckoutData = {
      id: checkoutId,
      status: data.status,
      restaurant: data.restaurant,
      items: data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        subtotal: item.subtotal,
      })),
      price: {
        subtotal: data.price.subtotal,
        discount: discountedPrice.discount,
        service: data.price.service,
        delivery: data.price.delivery,
        tax: data.price.tax,
        tip: data.price.tip,
        credit: data.price.credit,
        total: calculatedTotal,
      },
      fulfillment: data.fulfillment,
      dropoff: data.dropoff,
      address: data.address,
      referral_code: data.referral_code,
      referral_applied: data.referral_applied,
      account: data.account,
      card: data.card,
      expiresAt: expiresAt,
    };

    await sendLoading(interaction, {
      title: "Preparing Order Ticket",
      description: [
        "**Setting Up Private Order Channel**",
        "",
        "Creating a secure, private channel for your order...",
        "This ensures your order details stay confidential.",
      ].join("\n"),
      footer: "Your order will be sent here once confirmed.",
    });

    const ticket = await createOrderTicket(interaction);
    await ticket.send({
      content: `<@${interaction.user.id}>`,
    });
    const checkoutMessage = await ticket.send(
      createCheckoutPanel({
        checkout: checkoutData,
        userId: interaction.user.id,
      }),
    );

    await sendSuccess(interaction, {
      title: "Order Ticket Ready",
      description: `Continue in ${ticket.toString()} — pricing your cart now.`,
      footer: "Your order stays private inside that ticket.",
    });

    return void scheduleOrderExpiry(
      ticket,
      savedOrderId,
      card._id,
      checkoutMessage,
      getExpireIn(expiresAt),
    );
  } catch (error) {
    await logError(interaction.client, "Order Processing Failed", error, {
      User: interaction.user.id,
    });

    await handleInteractionError(
      interaction,
      error,
      "Failed to process your order. Please try again later.",
    );
  }
}
export async function handleCloseOrder(
  interaction: ChatInputCommandInteraction,
) {
  const channel = interaction.channel;

  if (channel?.type !== ChannelType.GuildText) {
    await sendError(interaction, {
      title: "Unable to Close Order",
      description: "This command can only be used in a server text channel.",
    });
    return;
  }

  if (channel.parentId !== env.orderTicketCategoryId) {
    await sendError(interaction, {
      title: "Invalid Channel",
      description: "This command can only be used inside an order ticket.",
    });
    return;
  }

  try {
    const closedBy =
      interaction.member instanceof GuildMember
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);

    await interaction.reply({
      content: `**Order closed by ${closedBy}. This ticket will be deleted in 5 seconds.**`,
      allowedMentions: {
        parse: [],
      },
    });

    setTimeout(() => {
      void channel.delete("Order closed.").catch(() => {});
    }, 5_000);
  } catch (error) {
    await sendError(interaction, {
      title: "Failed to Close Order",
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
export async function handleCloseAllOrders(
  interaction: ChatInputCommandInteraction,
) {
  if (!(await requireAdmin(interaction))) return;
  const displayName =
    interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : (interaction.user.globalName ?? interaction.user.username);

  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const category = await interaction.guild?.channels.fetch(
      env.orderTicketCategoryId,
    );

    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.editReply({
        content: "Order ticket category not found.",
      });
      return;
    }

    const tickets = category.children.cache;

    if (tickets.size === 0) {
      await interaction.editReply({
        content: "There are no open order tickets to delete.",
      });
      return;
    }

    let deleted = 0;
    let failed = 0;

    for (const ticket of tickets.values()) {
      try {
        await ticket.delete(
          `All order tickets have been deleted by admin ${displayName}`,
        );
        deleted++;
      } catch {
        failed++;
      }
    }

    await interaction.editReply({
      content: `Order ticket cleanup completed.\nDeleted: ${deleted}\nFailed: ${failed}`,
    });
  } catch (error) {
    await interaction
      .editReply({
        content: `Failed to delete order tickets: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
      .catch(() => {});
  }
}
