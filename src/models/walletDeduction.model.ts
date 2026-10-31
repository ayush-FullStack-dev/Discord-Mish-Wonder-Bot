import { Schema } from "mongoose";
import { WalletAccount } from "./balance.model.js";

const walletDeductionSchema = new Schema(
  {
    _id: String,
    uid: {
      type: String,
      required: true,
    },
    cents: {
      type: Schema.Types.BigInt,
      required: true,
    },
  },
  {
    collection: "wallet_deductions",
    autoIndex: false,
    timestamps: false,
    versionKey: false,
  },
);

export const WalletDeduction = WalletAccount.db.model(
  "WalletDeduction",
  walletDeductionSchema,
  "wallet_deductions",
);
