import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type TextChannel,
} from "discord.js";

type SendOrderExpiredOptions = {
  ticket: TextChannel;
  expiresIn: number;
};

export async function sendOrderExpired({
  ticket,
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
        "Your order has expired. Please create a new one.",
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Orders expire after ${expiresIn + 20} seconds of inactivity`,
      ),
    );

  return ticket.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
