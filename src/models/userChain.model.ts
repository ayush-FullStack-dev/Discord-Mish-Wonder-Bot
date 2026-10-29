import { Schema, model } from "mongoose";

const userChainSchema = new Schema(
  {
    discordId: {
      type: String,
      default: null
    },
    lastChain: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const UserChain = model("UserChain", userChainSchema);
