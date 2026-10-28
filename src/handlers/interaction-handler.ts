import { Events, type Client } from "discord.js";
import { createOrderModal } from "../ui/order/order-modal.js";
import {
  handleCloseOrder,
  handleDeleteAllOrders,
  handleOrderModal,
} from "../controllers/order/order.controller.js";
import { postShopPanel } from "../controllers/post-shop.controller.js";
import {
  handleAddBulkCard,
  handleAddSingleCard,
  handleDeleteAllCards,
  handleDeleteCard,
} from "../controllers/card.controller.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../utils/error-handler.js";
import { handleCancelOrder } from "../controllers/order/cancel-order.controller.js";
import { handleConfirmOrder } from "../controllers/order/confirm-order.controller.js";
import { sendSuccessAndLog } from "../utils/logger.js";
import { checkBalance } from "../controllers/balance.controller.js";
import { handleEarnings } from "../controllers/earnings.controller.js";
import {
  handleGetDiscount,
  handleSetDiscount,
} from "../controllers/discount.controller.js";

export function registerInteractionHandler(client: Client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "ping") {
          await sendSuccessAndLog(
            interaction,
            "Pong!",
            "The bot is online and responding normally.",
            "MishGPT • System Operational",
            { command: interaction.commandName },
          );
        }
        if (interaction.commandName === "post-shop") {
          await postShopPanel(interaction, client);
        }

        if (interaction.commandName === "close-order") {
          await handleCloseOrder(interaction);
        }
        if (interaction.commandName === "close-all-orders") {
          await handleDeleteAllOrders(interaction);
        }
        if (interaction.commandName === "earnings") {
          await handleEarnings(interaction);
        }
        if (interaction.commandName === "set-discount") {
          await handleSetDiscount(interaction);
        }
        if (interaction.commandName === "get-discount") {
          await handleGetDiscount(interaction);
        }

        if (interaction.commandName === "add-card") {
          await handleAddSingleCard(interaction);
        }
        if (interaction.commandName === "add-bulk-cards") {
          await handleAddBulkCard(interaction);
        }
        if (interaction.commandName === "delete-card") {
          await handleDeleteCard(interaction);
        }
        if (interaction.commandName === "delete-all-cards") {
          await handleDeleteAllCards(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === "wonder:buy") {
          await attemptInteractionResponse(interaction, () =>
            interaction.showModal(createOrderModal()),
          );
          return;
        }

        if (interaction.customId === "wonder:balance") {
          await checkBalance(interaction);
          return;
        }

        if (interaction.customId.startsWith("wonder:confirm:")) {
          await handleConfirmOrder(interaction);
          return;
        }

        if (interaction.customId.startsWith("wonder:cancel:")) {
          await handleCancelOrder(interaction);
          return;
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "wonder:order") {
          await handleOrderModal(interaction);
          return;
        }
      }
    } catch (error) {
      await handleInteractionError(interaction, error);
    }
  });
}
