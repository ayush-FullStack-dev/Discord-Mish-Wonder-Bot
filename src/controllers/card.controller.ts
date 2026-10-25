import type { ChatInputCommandInteraction } from "discord.js";
import { requireAdmin } from "../middleware.js";
import { MessageFlags } from "discord.js";
import { validateCardReference } from "../utils/validate-card.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
  UserFacingError,
} from "../utils/error-handler.js";
import { addCard } from "../services/card.service.js";

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

    const { cardnumber, cvv, expdate, zipcode } =
      validateCardReference(cardReference);

    try {
      await addCard({
        cards: [`${cardnumber},${expdate},${cvv},${zipcode}`],
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

    const cards: CardReference[] = [];
    const cardsInfo: string[] = [];
    let skipped = 0;

    for (const line of lines) {
      try {
        const fields = line.split("|").map((field) => field.trim());

        if (fields.length < 7) {
          skipped++;
          continue;
        }

        const record = validateCardReference(fields.slice(0, 7).join("|"));

        cardsInfo.push(
          `${record.cardnumber},${record.expdate},${record.cvv},${record.zipcode}`,
        );

        cards.push(record);
      } catch {
        skipped++;
      }
    }

    const requestedCount = cardsInfo.length;

    try {
      const data = await addCard({
        cards: cardsInfo,
      });

      skipped += data.rejected.length;
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