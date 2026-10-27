import { WalletAccount } from "../models/balance.model.js";

export async function getBalance(uid: string): Promise<bigint | null> {
  const account = await WalletAccount.findById(uid)
    .select({ cents: 1 })
    .lean()
    .exec();

  if (!account) return null;

  return account.cents ?? 0n;
}

export async function updateBalance(
  uid: string,
  cents: bigint,
): Promise<bigint | null> {
  const account = await WalletAccount.findOneAndUpdate(
    { _id: uid },
    { $set: { cents, updated_at: new Date() } },
    {
      returnDocument: "after",
      upsert: false,
      runValidators: true,
    },
  ).exec();

  if (!account) return null;

  return account.cents ?? 0n;
}

export async function deductBalance(
  uid: string,
  cents: bigint,
): Promise<bigint | null> {
  const account = await WalletAccount.findOneAndUpdate(
    {
      _id: uid,
      cents: { $gte: cents },
    },
    {
      $inc: { cents: -cents, updated_at: new Date() },
    },
    {
      returnDocument: "after",
      upsert: false,
    },
  ).exec();

  return account?.cents ?? null;
}
