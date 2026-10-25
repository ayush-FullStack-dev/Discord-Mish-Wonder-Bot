import { Events, type Client } from "discord.js";
import { createOrderModal } from "../ui/order/order-modal.js";
import { handleOrderModal } from "../controllers/order.controller.js";
import { postShopPanel } from "../controllers/post-shop.controller.js";
import {
  handleAddBulkCard,
  handleAddSingleCard,
} from "../controllers/card.controller.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../utils/error-handler.js";

export function registerInteractionHandler(client: Client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "post-shop") {
          await postShopPanel(interaction, client);
        }

        if (interaction.commandName === "add-card") {
          await handleAddSingleCard(interaction);
        }

        if (interaction.commandName === "add-bulk-cards") {
          await handleAddBulkCard(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === "wonder:buy") {
          await attemptInteractionResponse(interaction, () =>
            interaction.showModal(createOrderModal()),
          );
          return;
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "wonder:order") {
          await handleOrderModal(interaction);
        }
      }
    } catch (error) {
      await handleInteractionError(interaction, error);
    }
  });
}
