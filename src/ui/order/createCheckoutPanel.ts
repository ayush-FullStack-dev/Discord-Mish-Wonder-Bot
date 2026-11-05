import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { formatCountdown } from "../../utils/util.js";

export interface CheckoutItem {
  name: string;
  quantity: number;
  subtotal: string;
}

export interface CheckoutData {
  id: string;
  status: string;
  restaurant: string;
  items: CheckoutItem[];

  price: {
    subtotal: number;
    discount: number;
    service: number;
    delivery: number;
    tax: number;
    tip: number;
    credit: number;
    total: number;
  };

  fulfillment: string;
  dropoff?: string | null;
  address?: string | null;
  referral_code?: string | null;
  referral_applied?: boolean;
  account?: string | null;
  card?: string | null;
  expiresAt: Date;
}

interface CheckoutPanelOptions {
  checkout: CheckoutData;
  userId: string;
}

const GREEN = 0x57f288;

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function readable(value?: string | null): string {
  if (!value) return "Not provided";

  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
export function createCheckoutPanel({
  checkout,
  userId,
}: CheckoutPanelOptions): MessageCreateOptions {
  const { price } = checkout;

  const items = checkout.items.length
    ? checkout.items
        .map(
          (item) =>
            `**${item.quantity}× ${item.name}**\n` +
            `Subtotal: ${item.subtotal}`,
        )
        .join("\n")
    : "No item details were returned by the checkout API.";

  const pricing = [
    `Subtotal: ${money(price.subtotal)}`,
    `Discount: ${money(price.discount)}`,
    `Service Fee: ${money(price.service)}`,
    `Delivery Fee: ${money(price.delivery)}`,
    `### Total: ${money(price.total)}`,
  ].join("\n");

  const expiryText =
    `<a:timer:1564693488078168064> **Checkout expires in:** ` +
    `${formatCountdown(checkout.expiresAt)}`;

  const container = new ContainerBuilder()
    .setAccentColor(GREEN)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "## <a:shopping_cart:1563809327486210088> Checkout Ready",
          `**${checkout.restaurant}**`,
          "Review your checkout details before confirming.",
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Large),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### \<a:OrderFood:1563933294775631952>  Order Items\n\n${items}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Large),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### <a:invoice_bill:1563845783034400939> Price Breakdown\n\n${pricing}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Large),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "### <a:Fooddeliverylocation:1563836870935318558> Delivery Details",
          `**Method:** ${readable(checkout.fulfillment)}`,
          `**Drop-off:** ${readable(checkout.dropoff)}`,
          checkout.address
            ? `**Address:** ${checkout.address}`
            : "**Address:** Not provided",
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Large),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "### <a:red_warn:1563801753822957749> Review Before Confirming",
          "Check your items, delivery details and final total.",
          "**Your order has not been placed yet.**",
          "",
          expiryText,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )

    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Your checkout stays private inside this ticket.",
      ),
    );

  const confirmButton = new ButtonBuilder()
    .setCustomId(`wonder:confirm:${checkout.id}`)
    .setLabel("Confirm Order")
    .setEmoji({
      name: "click",
      id: "1563861291137765396",
    })
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`wonder:cancel:${checkout.id}`)
    .setLabel("Cancel Checkout")
    .setEmoji({
      name: "RemoveFromCart",
      id: "1563945863280332961",
    })
    .setStyle(ButtonStyle.Danger);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    confirmButton,
    cancelButton,
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container, buttons],
    allowedMentions: {
      users: [userId],
    },
  };
}
