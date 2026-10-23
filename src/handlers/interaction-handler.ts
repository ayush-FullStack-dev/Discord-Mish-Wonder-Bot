import { Events, type Client } from "discord.js";
import { errorLog } from "../../logs/printLogs.js";
import { createOrderModal } from "../ui/order-modal.js";
import { handleOrderModal } from "../controllers/order.controller.js";
import { postShopPanel } from "../controllers/post-shop.controller.js";
import {
  handleAddBulkCard,
  handleAddSingleCard,
} from "../controllers/card.controller.js";
import { MessageFlags } from "discord.js";

export function registerInteractionHandler(client: Client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "post-shop") {
          postShopPanel(interaction, client);
        }

        if (interaction.commandName === "add-card") {
          handleAddSingleCard(interaction);
        }

        if (interaction.commandName === "add-bulk-cards") {
          handleAddBulkCard(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === "wonder:buy") {
          await interaction.showModal(createOrderModal());
          return;
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "wonder:order") {
          handleOrderModal(interaction);
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
            flags: MessageFlags.Ephemeral,
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
