import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type RepliableInteraction,
} from "discord.js";
import { attemptInteractionResponse } from "../../utils/interaction-response.js";

type LoadingOptions = {
  title?: string;
  description: string;
  footer?: string;
  ephemeral?: boolean;
};

export async function sendLoading(
  interaction: RepliableInteraction,
  options: LoadingOptions,
) {
  const container = new ContainerBuilder()
    .setAccentColor(0xfee75c)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## <a:loading:1563867571793698867>  ${options.title ?? "Processing Request"}`,
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
        `-# ${options.footer ?? "Please wait while we process your request."}`,
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
