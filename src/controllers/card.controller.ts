import type { ChatInputCommandInteraction } from "discord.js";
import { requireAdmin } from "../middleware.js";
import { Card } from "../models/card.model.js";
import { encrypt } from "../utils/encryption.js";
import { MessageFlags } from "discord.js";
import { validateCardReference } from "../utils/validate-card.js";

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

    await interaction.deferReply({ ephemeral: true });

    const cardReference = interaction.options.getString("card-info", true);

    const { cardnumber, cvv, expdate, address, city, state, zipcode } =
      validateCardReference(cardReference);

    await Card.create({
      encryptedCardNumber: encrypt(cardnumber.trim()),
      encryptedCardCvv: encrypt(cvv.trim()),
      expiryDate: expdate,
      location: address,
      city: city,
      state,
      zipcode: zipcode,
    });

    await interaction.editReply({ content: "Card added successfully." });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleAddBulkCard(
  interaction: ChatInputCommandInteraction,
) {
  try {
    if (!(await requireAdmin(interaction))) return;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    console.log(interaction.options.getAttachment("file", true));
    const file = interaction.options.getAttachment("file", true);

    if (
      !file.name.toLowerCase().endsWith(".txt") ||
      file.contentType !== "text/plain"
    ) {
      throw new Error("Please upload a .txt file.");
    }

    const response = await fetch(file.url);

    if (!response.ok) {
      throw new Error("Failed to read the uploaded file.");
    }

    const content = await response.text();

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error("The uploaded file is empty.");
    }

    const cards: CardReference[] = [];
    let skipped = 0;

    for (const line of lines) {
      try {
        const card = validateCardReference(line);
        cards.push(card);
      } catch {
        skipped++;
      }
    }

    console.log(cards);
    if (cards.length === 0) {
      await interaction.editReply({
        content: `No valid records found. Skipped: ${skipped}.`,
      });
      return;
    }

    await interaction.editReply({
      content: [
        "File validation completed.",
        `Valid records: ${cards.length}`,
        `Skipped records: ${skipped}`,
      ].join("\n"),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: message,
        });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error("Failed to respond to interaction:", replyError);
    }
  }
}
