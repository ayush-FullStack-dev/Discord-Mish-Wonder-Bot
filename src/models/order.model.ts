import { Schema, model, models } from "mongoose";

const orderSchema = new Schema(
  {
    discordUserId: {
      type: String,
      required: true,
      index: true,
    },

    username: {
      type: String,
      required: true,
    },

    checkoutId: {
      type: String,
      required: true,
      unique: true,
    },

    orderId: {
      type: String,
      default: null,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "failed", "cancelled", "unknown"],
      default: "pending",
      index: true,
    },

    trackingUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

orderSchema.index({ createdAt: -1 });

export const Order = models.Order || model("Order", orderSchema);
