import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type Message,
} from "discord.js";
import { env } from "../../config/env.js";
import { formatCountdown } from "../../utils/util.js";

type SendOrderExpiredOptions = {
  replyTo: Message;
  expiresIn: number;
};

export async function sendOrderExpired({
  replyTo,
  expiresIn,
}: SendOrderExpiredOptions) {
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## <:alert:1563650830505349241> Order Expired",
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "Your checkout session has expired due to inactivity.",
          "",
          "This order is no longer active, and its checkout session has been closed.",
          "",
          "**What to do next?**",
          "- Place a new order using the same cart code, if it's still valid.",
          "- Alternatively, use a different cart code to start a new order.",
          "",
          `Head over to <#${env.shopChannelId}> to place your new order.`,
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
        `-# Checkout sessions expire after ${formatCountdown(expiresIn + 20)} of inactivity. Please complete your checkout before the timer runs out.`,
      ),
    );

  return replyTo.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
