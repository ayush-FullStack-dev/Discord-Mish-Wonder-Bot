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
import { ADMIN_USERID } from "../constants/constant.js";

const BOT_OWNER_ID = "1525807833277268060";
const TIMEZONE = "Asia/Kolkata";

type EarningsMode =
  | "last24hours"
  | "last7days"
  | "last30days"
  | "last365days"
  | "day"
  | "yesterday"
  | "week"
  | "month"
  | "lastmonth"
  | "year"
  | "lastyear";

interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

function getISTDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday")!,
  };
}

function getISTMidnightUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 5.5 * 60 * 60 * 1000);
}

function getDateRange(mode: EarningsMode, now: Date): DateRange {
  const { year, month, day, weekday } = getISTDateParts(now);

  const today = getISTMidnightUTC(year, month, day);

  const weekdays: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };

  switch (mode) {
    case "day":
      return {
        start: today,
        end: now,
        label: "Today",
      };

    case "yesterday":
      return {
        start: getISTMidnightUTC(year, month, day - 1),
        end: today,
        label: "Yesterday",
      };

    case "last24hours":
      return {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 24 Hours",
      };

    case "week": {
      const weekdays: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };

      const daysSinceMonday = weekdays[weekday];

      if (daysSinceMonday === undefined) {
        throw new Error(`Invalid weekday: ${weekday}`);
      }

      const start = getISTMidnightUTC(year, month, day - daysSinceMonday);

      return {
        start,
        end: now,
        label: "This Week",
      };
    }

    case "month":
      return {
        start: getISTMidnightUTC(year, month, 1),
        end: now,
        label: "This Month",
      };

    case "lastmonth":
      return {
        start: getISTMidnightUTC(year, month - 1, 1),
        end: getISTMidnightUTC(year, month, 1),
        label: "Previous Month",
      };

    case "last7days":
      return {
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 7 Days",
      };

    case "last30days":
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 30 Days",
      };

    case "year":
      return {
        start: getISTMidnightUTC(year, 1, 1),
        end: now,
        label: "This Year",
      };

    case "lastyear":
      return {
        start: getISTMidnightUTC(year - 1, 1, 1),
        end: getISTMidnightUTC(year, 1, 1),
        label: "Previous Year",
      };

    case "last365days":
      return {
        start: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 365 Days",
      };
  }
}

export async function handleEarnings(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const mode = interaction.options.getString("mode", true) as EarningsMode;

  try {
    if (!(await requireAdmin(interaction))) return;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const now = new Date();

    const { start, end, label } = getDateRange(mode, now);

    const showProfit = interaction.user.id === BOT_OWNER_ID;
    const orders = await Order.find({
      createdAt: {
        $gte: start,
        $lt: end,
      },
      status: "confirmed",
      discordUserId: { $nin: ADMIN_USERID.filter(id => id !== BOT_OWNER_ID) },
    })
      .select(showProfit ? "total cost" : "total")
      .lean();

    const totalOrders = orders.length;

    const totalAmount = orders.reduce((sum, order) => sum + order.total, 0);

    const earningsFields = showProfit
      ? [
          `**Total Orders**\n${totalOrders.toLocaleString("en-US")}`,
          `**Total Sales**\n$${totalAmount.toFixed(2)}`,
          `**Total Profit**\n$${orders
            .reduce((sum, order) => sum + order.total - order.cost, 0)
            .toFixed(2)}`,
        ]
      : [
          `**Total Orders**\n${totalOrders.toLocaleString("en-US")}`,
          `**Total Amount**\n$${totalAmount.toFixed(2)}`,
        ];

    const container = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## <a:analytics:1564538016742248488> Earnings — ${label}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(earningsFields.join("\n\n")),
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
