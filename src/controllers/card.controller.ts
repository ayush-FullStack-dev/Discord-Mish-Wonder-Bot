import type { ChatInputCommandInteraction } from "discord.js";
import { requireAdmin } from "../middleware.js";
import { MessageFlags } from "discord.js";
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

type CardReference = {
  cardnumber: string;
  cvv: string;
  expdate: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
};

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

    const { cardnumber, cvv, expdate, zipcode, state, city, address } =
      validateCardReference(cardReference);

    try {
      await addCard({
        encryptedCardNumber: cardnumber,
        encryptedCardCvv: cvv,
        expiryDate: expdate,
        zipcode: zipcode,
        state: state,
        city: city,
        address: address,
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

export async function handleAddBulkCard(
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
        const fields = line.split("|").map((field) => field.trim());

        if (fields.length < 7) {
          skipped++;
          continue;
        }

        const record = validateCardReference(fields.slice(0, 7).join("|"));

        cards.push({
          ...record,
          encryptedCardNumber: record.cardnumber,
          encryptedCardCvv: record.cvv,
          expiryDate: record.expdate,
        });
      } catch {
        skipped++;
      }
    }

    const requestedCount = cards.length;

    try {
      const data = await addManyCards(cards);

      skipped += data.rejectedCount;
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
          requestedCount > skipped
            ? `${skipped === 0 ? "All" : requestedCount - skipped} cards have been added successfully.`
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
