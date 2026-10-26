import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type RepliableInteraction,
} from "discord.js";
import { env } from "../config/env.js";
import { sendSuccess } from "../ui/utils/sendSuccess.js";
import { sendError } from "../ui/utils/sendError.js";

type LogOptions = {
  title: string;
  description: string;
  color: ColorResolvable;
  details?: Record<string, string>;
};

async function sendLog(
  client: Client,
  channelId: string,
  options: LogOptions,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel?.isTextBased() || !("send" in channel)) {
      console.error(
        `Discord log channel ${channelId} is unavailable or not text-based.`,
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(options.color)
      .setTitle(options.title)
      .setDescription(options.description)
      .setTimestamp();

    for (const [name, value] of Object.entries(options.details ?? {})) {
      embed.addFields({
        name,
        value: value.slice(0, 1024) || "N/A",
        inline: true,
      });
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Failed to send Discord log:", error);
  }
}

export async function logSuccess(
  client: Client,
  title: string,
  description: string,
  details?: Record<string, string>,
): Promise<void> {
  await sendLog(client, env.successChannelId, {
    title: `<a:success_tick2:1563913347319996559> ${title}`,
    description,
    color: 0x22c55e,
    ...(details ? { details } : {}),
  });
}

export async function logError(
  client: Client,
  title: string,
  error: unknown,
  details?: Record<string, string>,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  await sendLog(client, env.errorChannelId, {
    title: `<:alert:1563650830505349241> ${title}`,
    description: message.slice(0, 4000) || "An unknown error occurred.",
    color: 0xef4444,
    ...(details ? { details } : {}),
  });
}

export async function sendSuccessAndLog(
  interaction: RepliableInteraction,
  title: string,
  description: string,
  footer: string,
  details?: Record<string, string>,
): Promise<void> {
  await sendSuccess(interaction, {
    title,
    description,
    footer,
  });

  await logSuccess(interaction.client, title, description, details);
}

export async function sendErrorAndLog(
  interaction: RepliableInteraction,
  title: string,
  description: string,
  footer: string,
  error?: unknown,
  details?: Record<string, string>,
): Promise<void> {
  await sendError(interaction, {
    title,
    description,
    footer,
  });

  if (error !== undefined) {
    await logError(interaction.client, title, error, details);
  } else {
    await sendLog(interaction.client, env.errorChannelId, {
      title: `<:alert:1563650830505349241> ${title}`,
      description,
      color: 0xef4444,
      ...(details ? { details } : {}),
    });
  }
}
