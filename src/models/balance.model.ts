import { Schema } from "mongoose";
import { getBalanceDatabase } from "../config/database.js";

const walletAccountSchema = new Schema(
  {
    _id: String,
    uid: String,
    cents: Schema.Types.BigInt,
    updated_at: Date,
  },
  {
    collection: "wallet_accounts",
    autoCreate: false,
    autoIndex: false,
    timestamps: false,
    versionKey: false,
    strict: false,
  },
);

const balanceDb = getBalanceDatabase();

export const WalletAccount = balanceDb.model(
  "WalletAccount",
  walletAccountSchema,
  "wallet_accounts",
);
