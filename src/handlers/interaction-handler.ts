import { Events, type Client } from "discord.js";
import { errorLog } from "../../logs/printLogs.js";
import { env } from "../config/env.js";
import { ADMIN_USERID } from "../constants/constant.js";
import { createShopPanel } from "../ui/shop-panel.js";
import { createOrderModal } from "../ui/order-modal.js";

export function registerInteractionHandler(client: Client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isModalSubmit()) {
        if (interaction.customId === "wonder:order") {
          const cartCode = interaction.fields.getTextInputValue("cart_code");

          console.log("Cart Code:", cartCode);
          console.log("User ID:", interaction.user.id);
          console.log("Username:", interaction.user.username);

          await interaction.reply({
            content: `✅ Cart code received: \`${cartCode}\``,
            ephemeral: true,
          });

          return;
        }
      }

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "post-shop") {
          if (!ADMIN_USERID.includes(interaction.user.id)) {
            await interaction.reply({
              content: "This command is not for you.",
              ephemeral: true,
            });
            return;
          }

          await interaction.deferReply({ ephemeral: true });

          const channel = await client.channels.fetch(env.shopChannelId);

          if (!channel?.isTextBased() || !("send" in channel)) {
            await interaction.editReply(
              "Shop channel not found or unsupported.",
            );
            return;
          }

          await channel.send(createShopPanel());

          await interaction.editReply("Shop panel posted successfully.");
          return;
        }
      }

      if (interaction.isButton()) {
        if (interaction.customId === "wonder:buy") {
          await interaction.showModal(createOrderModal());
          return;
        }

        if (interaction.customId === "wonder:deposit") {
          await interaction.reply({
            content: "Enter the amount you want to deposit.",
            ephemeral: true,
          });

          return;
        }
      }
    } catch (error) {
      errorLog(`Interaction error: ${error}`);

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content: "Something went wrong. Please try again.",
            ephemeral: true,
          })
          .catch(() => {});
      } else if (interaction.isRepliable() && interaction.deferred) {
        await interaction
          .editReply("Something went wrong. Please try again.")
          .catch(() => {});
      }
    }
  });
}
