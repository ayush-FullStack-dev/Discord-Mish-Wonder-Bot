import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { requireAdmin } from "../middleware.js";
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { validateCardReference } from "../utils/validate-card.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
  UserFacingError,
} from "../utils/error-handler.js";
import {
  addCard,
  addManyCards,
  burnCard,
  deleteCards,
} from "../services/card.service.js";
import type { ICard } from "../types/index.js";

export async function handleAddSingleCard(
  interaction: ChatInputCommandInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const cardReference = interaction.options.getString("card-info", true);

    const {
      cardnumber,
      cvv,
      expdate,
      fullname,
      zipcode,
      state,
      city,
      address,
    } = validateCardReference(cardReference);

    try {
      await addCard({
        encryptedCardNumber: cardnumber,
        encryptedCardCvv: cvv,
        expiryDate: expdate,
        zipcode: zipcode,
        state: state,
        city: city,
        address: address,
        fullname: fullname ?? null,
      });
    } catch (error) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: "Failed to add card. Please try again.",
        }),
      );
      return;
    }

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({ content: "Card added successfully." }),
    );
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

export async function handleImportCards(
  interaction: ChatInputCommandInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const file = interaction.options.getAttachment("file", true);

    if (
      !file.name.toLowerCase().endsWith(".txt") ||
      !file.contentType?.toLowerCase().startsWith("text/plain")
    ) {
      throw new UserFacingError("Please upload a .txt file.");
    }

    const response = await fetch(file.url);

    if (!response.ok) {
      throw new UserFacingError("Failed to read the uploaded file.");
    }

    const content = await response.text();

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new UserFacingError("The uploaded file is empty.");
    }

    const cards: ICard[] = [];
    let skipped = 0;

    for (const line of lines) {
      try {
        const record = validateCardReference(line);

        cards.push({
          encryptedCardNumber: record.cardnumber,
          encryptedCardCvv: record.cvv,
          expiryDate: record.expdate,
          zipcode: record.zipcode,
          state: record.state,
          city: record.city,
          fullname: record.fullname ?? null,
          address: record.address,
        });
      } catch {
        skipped++;
      }
    }

    let addedCount = 0;

    try {
      const data = await addManyCards(cards);

      skipped += data.rejectedCount;
      addedCount = data.acceptedCount;
    } catch (error) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: "Failed to add cards. Please try again.",
        }),
      );

      return;
    }

    if (cards.length === 0) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: `No valid records found. Skipped: ${skipped}.`,
        }),
      );
      return;
    }

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content:
          addedCount > 0
            ? `${addedCount} cards have been added successfully.`
            : "No cards added.",
      }),
    );
    return;
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

export async function handleAddBulkCards(
  interaction: ChatInputCommandInteraction,
) {
  const modal = new ModalBuilder()
    .setCustomId("cards:bulk-add")
    .setTitle("Add VCCs");

  const cardReferencesInput = new TextInputBuilder()
    .setCustomId("card-references")
    .setLabel("Card References — one per line")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(cardReferencesInput),
  );

  await interaction.showModal(modal);
}

export async function handleBulkAddCardsSubmit(
  interaction: ModalSubmitInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );
    const content = interaction.fields.getTextInputValue("card-references");

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new UserFacingError("Please provide valid input.");
    }

    const cards: ICard[] = [];
    let skipped = 0;

    for (const line of lines) {
      try {
        const record = validateCardReference(line);

        cards.push({
          encryptedCardNumber: record.cardnumber,
          encryptedCardCvv: record.cvv,
          expiryDate: record.expdate,
          zipcode: record.zipcode,
          state: record.state,
          city: record.city,
          fullname: record.fullname ?? null,
          address: record.address,
        });
      } catch {
        skipped++;
      }
    }

    let addedCount = 0;

    try {
      const data = await addManyCards(cards);

      skipped += data.rejectedCount;
      addedCount = data.acceptedCount;
    } catch (error) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: "Failed to add cards. Please try again.",
        }),
      );

      return;
    }

    if (cards.length === 0) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: `No valid records found. Skipped: ${skipped}.`,
        }),
      );
      return;
    }

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content:
          addedCount > 0
            ? `${addedCount} cards have been added successfully.`
            : "No cards added.",
      }),
    );
    return;
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

export async function handleDeleteCard(
  interaction: ChatInputCommandInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const lastFour = interaction.options.getString("last-four", true).trim();

    if (!/^\d{4}$/.test(lastFour)) {
      await attemptInteractionResponse(interaction, () =>
        interaction.editReply({
          content: "Please provide exactly the last four digits of the card.",
        }),
      );
      return;
    }

    await burnCard(lastFour);

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content: `Card ending in ${lastFour} deleted successfully.`,
      }),
    );
  } catch (error) {
    return await interaction
      .editReply({
        content: `Failed to delete card: ${error instanceof Error ? error.message : String(error)}`,
      })
      .catch(() => {});
  }
}

export async function handleDeleteAllCards(
  interaction: ChatInputCommandInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    await deleteCards();

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content: "All cards have been deleted successfully.",
      }),
    );
  } catch (error) {
    return await interaction
      .editReply({
        content: `Failed to delete all cards: ${error instanceof Error ? error.message : String(error)}`,
      })
      .catch(() => {});
  }
}
