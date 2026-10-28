import { Schema, model } from "mongoose";

const cardSchema = new Schema(
  {
    encryptedCardNumber: {
      type: String,
      required: true,
    },

    last4Digits: {
      type: String,
      required: true,
      minlength: 4,
      maxlength: 4,
    },

    encryptedCardCvv: {
      type: String,
      required: true,
    },

    expiryDate: {
      type: String,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },

    zipcode: {
      type: String,
      required: true,
    },

    state: {
      type: String,
      required: true,
    },

    city: {
      type: String,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    isLocked: {
      type: Boolean,
      default: false,
      index: true,
    },

    isPin: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastUsedBy: {
      type: String,
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "expired", "blocked"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Card = model("Card", cardSchema);
