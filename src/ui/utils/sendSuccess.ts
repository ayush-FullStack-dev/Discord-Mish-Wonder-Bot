import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type RepliableInteraction,
} from "discord.js";
import { attemptInteractionResponse } from "../../utils/interaction-response.js";

type SuccessOptions = {
  title?: string;
  description: string;
  footer?: string;
  ephemeral?: boolean;
};

export async function sendSuccess(
  interaction: RepliableInteraction,
  options: SuccessOptions,
) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f288)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## <a:success_tick2:1563913347319996559>  ${options.title ?? "Success"}`,
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
        `-# ${options.footer ?? "Completed successfully."}`,
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
