import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { ChannelType, GuildMember, MessageFlags } from "discord.js";
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
  secondsToMilliseconds,
} from "../../utils/util.js";
import { getBalance } from "../../services/balance.service.js";
import { env } from "../../config/env.js";
import { requireAdmin } from "../../middleware.js";
import { logError, sendErrorAndLog } from "../../utils/logger.js";
import { Card } from "../../models/card.model.js";
import { decrypt } from "../../utils/encryption.js";
import {
  minimumOrderSubTotal,
  maxOrderAmount,
} from "../../constants/constant.js";
import { getDiscountPercentage } from "../../services/discount.service.js";
import { sendOrderExpired } from "../../ui/order/sendOrderExpired.js";

const ORDER_ERRORS: Record<
  string,
  { title: string; description: string; footer: string }
> = {
  BAD_CART: {
    title: "Invalid or Expired Cart Code",
    description:
      "Your cart code is invalid or has expired.\nPlease grab your cart again and enter a fresh code.",
    footer: "Try again with a fresh cart code.",
  },
  CART_REQUIRED: {
    title: "Cart Code Required",
    description:
      "We couldn't find a valid cart.\nPlease grab your cart again and submit its code.",
    footer: "Make sure you copy the complete cart code.",
  },
  NO_CARD: {
    title: "No Payment Method Available",
    description:
      "We couldn't prepare your checkout because no payment method is available.\nPlease contact support.",
    footer: "Our support team can help.",
  },
  CARD_REQUIRED: {
    title: "Payment Method Required",
    description:
      "A payment method is required for this checkout.\nPlease contact support for assistance.",
    footer: "Contact support if you need help.",
  },
  UNAUTHORIZED: {
    title: "Service Temporarily Unavailable",
    description:
      "We couldn't authenticate your checkout request.\nPlease try again later.",
    footer: "Contact support if the issue persists.",
  },
  RATE_LIMITED: {
    title: "Too Many Requests",
    description:
      "The checkout service is receiving too many requests.\nPlease wait a moment before trying again.",
    footer: "Please try again shortly.",
  },
  UNKNOWN_ERROR: {
    title: "Something Went Wrong",
    description:
      "We couldn't process your checkout request.\nPlease try again later.",
    footer: "Contact support if the issue persists.",
  },
};

export async function handleOrderModal(interaction: ModalSubmitInteraction) {
  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );

  try {
    const cartCode = interaction.fields.getTextInputValue("cart_code").trim();

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

    const payCard = {
      cardNumber: decrypt(card.encryptedCardNumber),
      cvv: decrypt(card.encryptedCardCvv),
      expiryDate: card.expiryDate,
      zipcode: card.zipcode,
    };

    const appliedDiscountPercentage = await getDiscountPercentage();

    const result = await createOrder(
      {
        cartCode,
      },
      payCard,
    );

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

      await sendError(
        interaction,
        ORDER_ERRORS[result.code] ?? {
          title: "Checkout Failed",
          description: result.message,
          footer: "Contact support if the issue persists.",
        },
      );

      return;
    }

    if (!("data" in result)) {
      throw new Error("Checkout response did not contain data.");
    }

    const data = result.data;

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
        const cancellation = await cancelOrder(data.id);
        checkoutCancelled = cancellation.ok;
        if (!cancellation.ok) {
          await logError(
            interaction.client,
            "Invalid Order Pricing Cancellation Failed",
            cancellation.message,
            {
              User: interaction.user.id,
              "Checkout ID": data.id,
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
            "Checkout ID": data.id,
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
          "Checkout ID": data.id,
        },
      );
      return;
    }

    const calculatedTotal = discountedPrice.total;

    if (data.price.subtotal < minimumOrderSubTotal) {
      const remainingAmount = (
        minimumOrderSubTotal - data.price.subtotal
      ).toFixed(2);

      try {
        await cancelOrder(data.id);
      } catch {
      } finally {
        return sendError(interaction, {
          title: "Minimum Order Not Met",
          description: `Your order total must be at least $${minimumOrderSubTotal}. Add another $${remainingAmount} to meet the minimum order requirement.`,
          footer: `Minimum order total: $${minimumOrderSubTotal}.`,
        });
      }
    } else if (calculatedTotal > maxOrderAmount) {
      try {
        await cancelOrder(data.id);
      } catch {
      } finally {
        return sendError(interaction, {
          title: "Order Total Exceeds Limit",
          description: `The total amount of your order exceeds the maximum allowed limit of $${maxOrderAmount}.`,
          footer: `Please place an order with a total amount less than $${maxOrderAmount}.`,
        });
      }
    }

    const displayName =
      interaction.member instanceof GuildMember
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);

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

    try {
      await Order.create({
        name: displayName,
        discordUserId: interaction.user.id,
        checkoutId: data.id,
        orderId: data.order_id,
        total: calculatedTotal,
        discountPercentage: appliedDiscountPercentage,
        confirming: false,
        expiresAt: formatExpiryDate(data.expires_in),
        card: card._id,
        cost: data.price.total,
      });

      await Card.findOneAndUpdate(
        { _id: card._id },
        { $set: { isLocked: true } },
      );
    } catch (error) {
      try {
        await cancelOrder(data.id);
      } catch {}
      await sendErrorAndLog(
        interaction,
        "Failed to Save Order",
        "Failed to save your order to the database. Please try again later.",
        "Your order has been cancelled. Please try again later.",
        error,
        {
          "Order ID": String(data.id),
          User: interaction.user.id,
        },
      );

      return sendError(interaction, {
        title: "Failed to Save Order",
        description:
          "Failed to save your order to the database. Please try again later.",
        footer: "Your order has been cancelled. Please try again later.",
      });
    }
    const checkoutData: CheckoutData = {
      id: data.id,
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
      expires_in: data.expires_in,
    };

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

    return setTimeout(
      async () => {
        const checkOrder = await Order.findOne({
          checkoutId: data.id,
          card: card._id,
        });

        if (!checkOrder) {
          await Card.findOneAndUpdate(
            { _id: card._id },
            { $set: { isLocked: false } },
          );

          await sendOrderExpired({
            replyTo: checkoutMessage,
            expiresIn: data.expires_in,
          });
        } else if (checkOrder.status === "pending") {
          await Order.findByIdAndDelete(checkOrder._id);

          await Card.findOneAndUpdate(
            { _id: card._id },
            { $set: { isLocked: false } },
          );

          await sendOrderExpired({
            replyTo: checkoutMessage,
            expiresIn: data.expires_in,
          });
        }
      },

      secondsToMilliseconds(data.expires_in + 10),
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
