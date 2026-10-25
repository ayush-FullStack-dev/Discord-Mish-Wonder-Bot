import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const createOrderModal = () => {
  const modal = new ModalBuilder()
    .setCustomId("wonder:order")
    .setTitle("Place Your Order");

  const cartCodeInput = new TextInputBuilder()
    .setCustomId("cart_code")
    .setLabel("Enter Your Cart Code")
    .setPlaceholder("e.g. ABC123")
    .setStyle(TextInputStyle.Short)
    .setMinLength(6)
    .setMaxLength(6)
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
    cartCodeInput,
  );

  modal.addComponents(row);

  return modal;
};