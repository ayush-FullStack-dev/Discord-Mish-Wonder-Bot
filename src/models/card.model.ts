import { Schema, model } from "mongoose";

const cardSchema = new Schema(
  {
    encryptedCardNumber: {
      type: String,
      required: true,
    },

    encryptedCardCvv: {
      type: String,
      required: true,
    },

    expiryDate: {
      type: String,
      required: true,
      trim: true,
    },

    zipcode: {
      type: String,
      required: true,
      trim: true,
    },

    state: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: String,
      required: true,
      trim: true,
    },

    brand: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ["active", "removed", "failed"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Card = model("Card", cardSchema);
