import {
  type ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { Order } from "../models/order.model.js";
import { logError } from "../utils/logger.js";
import { requireAdmin } from "../middleware.js";

export async function handleEarnings(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const mode = interaction.options.getString("mode", true);

  try {
    if (!(await requireAdmin(interaction))) return;
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const now = new Date();
    const start = new Date(now);

    switch (mode) {
      case "day":
        start.setHours(0, 0, 0, 0);
        break;

      case "week": {
        start.setHours(0, 0, 0, 0);
        const day = start.getDay();
        start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
        break;
      }

      case "month":
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;

      case "year":
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        break;

      default:
        await interaction.editReply({
          content: "Invalid earnings period.",
          components: [],
        });
        return;
    }

    const orders = await Order.find({
      createdAt: { $gte: start, $lte: now },
      status: "confirmed",
    })
      .select("total")
      .lean();

    const totalOrders = orders.length;
    const totalAmount = orders.reduce((sum, order) => sum + order.total, 0);

    const periodLabels: Record<string, string> = {
      day: "Today",
      week: "This Week",
      month: "This Month",
      year: "This Year",
    };

    const container = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## <a:analytics:1564538016742248488> Earnings — ${periodLabels[mode]}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `**Total Orders**\n${totalOrders.toLocaleString("en-US")}`,
            `**Total Amount**\n$${totalAmount.toFixed(2)}`,
          ].join("\n\n"),
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Updated <t:${Math.floor(now.getTime() / 1000)}:R>`,
        ),
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    await logError(interaction.client, "Earnings Command Failed", error, {
      User: interaction.user.id,
      Period: mode,
    });

    await interaction.editReply({
      content: "Failed to fetch earnings statistics. Please try again later.",
      components: [],
    });
  }
}
