import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export function createShopPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x16a968)
    .setTitle("\<a:emojy:1563101604788310026> Wonder Shop")
    .setDescription(
      [
        "MiSH • Self Checkout",
        "",
        "Order from Wonder directly through Discord.",
        "Fast, simple, and secure.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "⚡ **How it works**",
        "",
        "01 🔗 **Tap Buy** — Enter your 6-character cart code",
        "02 🛒 **Cart checked** — Items, restaurant and availability",
        "03 🧾 **Price shown** — Review your actual total",
        "04 ✅ **You confirm** — Approve before placing the order",
        "05 📦 **Order placed** — Get your order details and tracking link",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "⚠️ **Before you order**",
        "",
        "🛒 Your cart must be valid and not empty",
        "🏪 The restaurant must accept the order",
        "💳 Ensure you have enough balance in your MiSH wallet",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "🔒 Nothing is ordered until you confirm.",
      ].join("\n"),
    )
    .setFooter({ text: "MiSH • Wonder Ordering" });

  const buyButton = new ButtonBuilder()
    .setCustomId("wonder:buy")
    .setLabel("Place order")
    .setEmoji({
      name: "cash",
      id: "1563101604788310026",
    })
    .setStyle(ButtonStyle.Success);

  const depositButton = new ButtonBuilder()
    .setCustomId("wonder:deposit")
    .setLabel("Deposit")
    .setEmoji("💳")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buyButton,
    depositButton,
  );

  return {
    embeds: [embed],
    components: [row],
  };
}
