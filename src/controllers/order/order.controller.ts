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
import { UserChain } from "../../models/userChain.model.js";
import { Order } from "../../models/order.model.js";
import { centsToDollars, formatExpiryDate } from "../../utils/util.js";
import {
  accountConfigure,
  getJobStatus,
} from "../../services/account.service.js";
import { getBalance } from "../../services/balance.service.js";
import { env } from "../../config/env.js";
import { requireAdmin } from "../../middleware.js";
import { logError, sendErrorAndLog } from "../../utils/logger.js";

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
    const oldChain = await UserChain.findOne()
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    let lastChain = oldChain?.lastChain || "1";

    const balance = await getBalance(interaction.user.id);
    if (balance === null || balance < 500) {
      return sendError(interaction, {
        title: "Insufficient Balance",
        description: "You need at least $5 to start a checkout.",
        footer: "Please deposit funds and try again.",
      });
    }
    const dollarBalance = centsToDollars(balance);

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

    try {
      await UserChain.findOneAndUpdate(
        { discordId: interaction.user.id },
        { $set: { lastChain } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } catch {}

    await sendLoading(interaction, {
      title: "Preparing Checkout",
      description: [
        "**Checking Cart & Restaurant Pricing**",
        "",
        "Validating your cart and preparing checkout details...",
      ].join("\n"),
      footer: "No order is placed until you confirm.",
    });

    const result = await createOrder({
      cartCode,
    });

    if (result.code !== null && result.code !== undefined) {
      if (
        ["NO_CARD", "CARD_REQUIRED", "UNAUTHORIZED", "UNKNOWN_ERROR"].includes(
          result.code,
        )
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

    if (data.price.total > Number(dollarBalance)) {
      const additionalFunds = (
        data.price.total - Number(dollarBalance)
      ).toFixed(2);

      try {
        await cancelOrder(data.id);
      } catch {
      } finally {
        return sendError(interaction, {
          title: "Insufficient Balance",
          description: `You need an additional $${additionalFunds} to complete this checkout.`,
          footer: "Please deposit more funds and try again.",
        });
      }
    }

    await sendLoading(interaction, {
      title: "Creating Your Account",
      description: [
        "**Setting Up Your Account**",
        "",
        "Creating your account and securely processing your registration...",
        "Please wait while we complete the setup.",
      ].join("\n"),
      footer:
        "Please don't close this interaction while your account is being created.",
    });

    try {
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
    } catch (error) {
      try {
        await cancelOrder(data.id);
      } catch {}

      await sendErrorAndLog(
        interaction,
        "Account Creation Failed",
        error instanceof Error
          ? error.message
          : "Failed to create your account. Please try again later.",
        "Your order has been cancelled. Please try again later.",
        error,
        {
          "Order ID": String(data.id),
          User: interaction.user.id,
          Chain: String(lastChain),
        },
      );

      return sendError(interaction, {
        title: "Account Creation Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create your account. Please try again later.",
        footer: "Your order has been cancelled. Please try again later.",
      });
    }

    const displayName =
      interaction.member instanceof GuildMember
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);

    const isOrder = await Order.create({
      name: displayName,
      discordUserId: interaction.user.id,
      checkoutId: data.id,
      orderId: data.order_id,
      total: data.price.total,
      confirming: false,
      expiresAt: formatExpiryDate(data.expires_in),
    });

    console.log(isOrder);

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
        referral: data.price.referral,
        service: data.price.service,
        delivery: data.price.delivery,
        tax: data.price.tax,
        tip: data.price.tip,
        credit: data.price.credit,
        total: data.price.total,
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

    await ticket.send(
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

    return;
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

    await channel.send(
      `**Order closed by ${closedBy}. This ticket will be deleted in 5 seconds.**`,
    );

    setTimeout(() => {
      void channel.delete("Order closed.").catch((error: unknown) => {});
    }, 5_000);
  } catch (error) {
    await sendError(interaction, {
      title: "Failed to Close Order",
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleDeleteAllOrders(
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
