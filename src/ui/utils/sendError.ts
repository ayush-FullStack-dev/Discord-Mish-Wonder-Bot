import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type RepliableInteraction,
} from "discord.js";
import { attemptInteractionResponse } from "../../utils/interaction-response.js";

type ErrorOptions = {
  title?: string;
  description: string;
  footer?: string;
  ephemeral?: boolean;
};

export async function sendError(
  interaction: RepliableInteraction,
  options: ErrorOptions,
) {
  const isPaymentError =
    /payment/i.test(options.title ?? "") ||
    /payment/i.test(options.description ?? "");

  const animatedEmojy = isPaymentError
    ? "<a:Nocreditcard1:1570213456911663214>"
    : "<a:WarningAlertIcon1:1569290870933430323>";
    
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${animatedEmojy} ${options.title ?? "Something Went Wrong"}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(options.description),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${options.footer ?? "Please try again later."}`,
      ),
    );

  if (interaction.deferred || interaction.replied) {
    return attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content: "",
        embeds: [],
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      }),
    );
  }

  return attemptInteractionResponse(interaction, () =>
    interaction.reply({
      components: [container],
      flags:
        MessageFlags.IsComponentsV2 |
        (options.ephemeral !== false ? MessageFlags.Ephemeral : 0),
    }),
  );
}
