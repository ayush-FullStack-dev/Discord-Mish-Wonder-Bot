import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type MessageCreateOptions,
} from "discord.js";

import valid from "card-validator";

export interface CardLogOptions {
  discordUserId: string;
  orderId: string;
  cardNumber: string;
  customerPay: number;
  discountPercentage: number;
  cost: number;
}

interface CardDetails {
  brand: string;
  cardNumber: string;
}

const GREEN = 0x57f288;

function maskCardNumber(cardNumber: string): string {
  const normalized = cardNumber.replace(/\D/g, "");

  if (normalized.length <= 4) {
    return normalized;
  }

  return "*".repeat(normalized.length - 4) + normalized.slice(-4);
}

function escapeDiscordMarkdown(text: string): string {
  return text.replace(/\*/g, "\\*");
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatTimestamp(): string {
  return new Date().toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function validateDiscordUserId(userId: string): void {
  if (!/^\d{17,20}$/.test(userId)) {
    throw new Error("Invalid Discord user ID.");
  }
}

function getCardDetails(cardNumber: string): CardDetails {
  const normalized = cardNumber.replace(/[\s-]/g, "");
  const validation = valid.number(normalized);

  if (!validation.isValid || !validation.card) {
    throw new Error("Invalid card number.");
  }

  return {
    brand: validation.card.niceType,
    cardNumber: maskCardNumber(normalized),
  };
}

function createDivider(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Large);
}

function createHeader(
  discordUserId: string,
  orderId: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    [
      "## <a:posmachineportable:1571985568085049536> Payment Activity",
      "-# MiSH · Transaction Record",
      "",
      `**Customer:** <@${discordUserId}>`,
      `-# Order ID: ${orderId}`,
    ].join("\n"),
  );
}

function createPaymentDetails(
  customerPay: number,
  discountPercentage: number,
  cost: number,
  card: CardDetails,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    [
      "### <a:ValidatingTicketPinch:1570747294649815040> Payment Details",
      `**Customer Pay:** ${formatMoney(customerPay)}`,
      `**Discount:** ${discountPercentage}%`,
      `**Cost:** ${formatMoney(cost)}`,
      "",
      `**${card.brand}:** ${escapeDiscordMarkdown(card.cardNumber)}`,
    ].join("\n"),
  );
}

function createFooter(): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    `-# MiSH Card Logs · ${formatTimestamp()}`,
  );
}

export function createCardLogPanel({
  discordUserId,
  orderId,
  cardNumber,
  customerPay,
  discountPercentage,
  cost,
}: CardLogOptions): MessageCreateOptions {
  validateDiscordUserId(discordUserId);

  const card = getCardDetails(cardNumber);

  const container = new ContainerBuilder()
    .setAccentColor(GREEN)
    .addTextDisplayComponents(createHeader(discordUserId, orderId))
    .addSeparatorComponents(createDivider())
    .addTextDisplayComponents(
      createPaymentDetails(
        customerPay,
        discountPercentage,
        cost,
        card,
      ),
    )
    .addSeparatorComponents(createDivider())
    .addTextDisplayComponents(createFooter());

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: [discordUserId],
    },
  };
}