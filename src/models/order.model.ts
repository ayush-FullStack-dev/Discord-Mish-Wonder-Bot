import { Schema, model } from "mongoose";

const orderSchema = new Schema(
  {
    discordUserId: {
      type: String,
      required: true,
      index: true,
    },

    name: {
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

    cost: {
      type: Number,
      required: true,
      default: 0,
    },

    discountPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "failed", "cancelled", "unknown"],
      default: "pending",
      index: true,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: { expires: 0 },
    },

    confirming: {
      type: Boolean,
      default: false,
    },

    card: {
      type: Schema.Types.ObjectId,
      ref: "Card",
      default: null,
      index: true,
    },

    repriceCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    repricedAt: {
      type: Date,
      default: null,
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

export const Order = model("Order", orderSchema);
