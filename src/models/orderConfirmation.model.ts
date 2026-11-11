import { Schema, model } from "mongoose";

// No TTL: this is the durable recovery record, not a checkout.
const schema = new Schema({
  _id: { type: Schema.Types.ObjectId, required: true },
  token: { type: String, required: true },
  discordUserId: { type: String, required: true },
  checkoutId: { type: String, required: true },
  total: { type: Number, required: true },
  card: { type: Schema.Types.ObjectId, default: null },
  state: {
    type: String,
    enum: ["requesting", "rejected", "confirmed", "settled"],
    required: true,
  },
  providerOrderId: { type: String, default: null },
  cost: { type: Number, default: null },
  trackingUrl: { type: String, default: null },
}, { timestamps: true });

schema.index({ state: 1, updatedAt: 1 });

export const OrderConfirmation = model("OrderConfirmation", schema);