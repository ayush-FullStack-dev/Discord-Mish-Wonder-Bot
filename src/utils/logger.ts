import {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  MessageFlags,
  type Client,
  type ColorResolvable,
  type RepliableInteraction,
} from "discord.js";

import { EmbedBuilder } from "discord.js";
import { env } from "../config/env.js";
import { sendSuccess } from "../ui/utils/sendSuccess.js";
import { sendError } from "../ui/utils/sendError.js";
import { PING_ROLESID } from "../constants/constant.js";

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
  pingRole = false,
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
      const displayValue =
        name.toLowerCase() === "user" && /^\d{17,20}$/.test(value)
          ? `<@${value}>`
          : value;

      embed.addFields({
        name,
        value: displayValue.slice(0, 1024) || "N/A",
        inline: true,
      });
    }

    const roleIds = pingRole ? PING_ROLESID : [];

    await channel.send({
      ...(roleIds.length > 0
        ? { content: roleIds.map((id) => `<@&${id}>`).join(" ") }
        : {}),
      embeds: [embed],
      allowedMentions: {
        parse: [],
        roles: roleIds,
      },
    });
  } catch (error) {
    console.error("Failed to send Discord log:", error);
  }
}

async function sendSuccessLog(
  client: Client,
  title: string,
  description: string,
  details?: Record<string, string>,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(env.successChannelId);

    if (!channel?.isTextBased() || !("send" in channel)) {
      console.error(
        `Discord success channel ${env.successChannelId} is unavailable or not text-based.`,
      );
      return;
    }

    const container = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## <a:success_tick2:1563913347319996559> ${title}`,
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      );

    const entries = Object.entries(details ?? {});

    if (entries.length > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      );

      const detailLines = entries.slice(0, 6).map(([name, value]) => {
        const displayValue =
          name.toLowerCase() === "user" && /^\d{17,20}$/.test(value)
            ? `<@${value}>`
            : value;

        return `**${name}**\n${displayValue.slice(0, 900) || "N/A"}`;
      });

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(detailLines.join("\n\n")),
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Success Logs • <t:${Math.floor(Date.now() / 1000)}:f>`,
      ),
    );

    await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error("Failed to send Discord success log:", error);
  }
}

export async function logSuccess(
  client: Client,
  title: string,
  description: string,
  details?: Record<string, string>,
): Promise<void> {
  await sendSuccessLog(client, title, description, details);
}

export async function logError(
  client: Client,
  title: string,
  error: unknown,
  details?: Record<string, string>,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  await sendLog(
    client,
    env.errorChannelId,
    {
      title: `<:alert:1563650830505349241> ${title}`,
      description: message.slice(0, 4000) || "An unknown error occurred.",
      color: 0xef4444,
      ...(details ? { details } : {}),
    },
    true,
  );
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
