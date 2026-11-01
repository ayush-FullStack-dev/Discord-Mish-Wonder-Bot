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

export function createShopPanel(): MessageCreateOptions {
  const container = new ContainerBuilder()
    .setAccentColor(0x16a968)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "## <a:shopping_cart:1563809327486210088> Wonder Shop • Self Checkout",
          "",
          "Order from Wonder directly through Discord.",
          "Fast, simple, and secure.",
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
        `### <a:shopping:1563847960251474090> How To Order`,
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "**01** <a:click:1563861291137765396> **Tap Place order**",
          "Enter your 6-character cart code.",
          "",
          "**02** <a:shopping_cart:1563809327486210088> **Cart checked**",
          "Review your cart items, restaurant, and availability.",
          "",
          "**03** <a:invoice_bill:1563845783034400939> **Price shown**",
          "Review the total before proceeding.",
          "",
          "**04** <a:order_placed:1563814138025742367>   **You confirm**",
          "Approve the order before it is placed.",
          "",
          "**05** <a:Fooddeliverylocation:1563836870935318558> **Order placed**",
          "Receive your order details and tracking link.",
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
          "### <:info:1563666701311283200>  Before you order",
          "",
          "<a:red_warn:1563801753822957749> Your cart must be valid and not empty.",
          "<a:red_warn:1563801753822957749> The restaurant must accept the order.",
          "<a:red_warn:1563801753822957749> Ensure your MiSH wallet has sufficient balance.",
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
        "<:info:1563666701311283200> Nothing is ordered until you confirm.",
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# MiSH • Wonder Ordering"),
    );

  const buyButton = new ButtonBuilder()
    .setCustomId("wonder:buy")
    .setLabel("Place Order")
    .setEmoji({
      name: "onlineshop",
      id: "1564357614307909682",
    })
    .setStyle(ButtonStyle.Success);

  const checkBalanceButton = new ButtonBuilder()
    .setCustomId("wonder:balance")
    .setLabel("Check My Balance")
    .setEmoji({
      name: "Wallet1",
      id: "1564334557636067390",
    })
    .setStyle(ButtonStyle.Secondary);

  const getCartCodeButton = new ButtonBuilder()
    .setLabel("Get Cart code")
    .setEmoji({
      name: "shopping_cart",
      id: "1563809327486210088",
    })
    .setStyle(ButtonStyle.Link)
    .setURL("https://wonder-builder-production.up.railway.app/");

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buyButton,
    checkBalanceButton,
  );

  const cartCodeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    getCartCodeButton,
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container, buttons, cartCodeRow],
  };
}
