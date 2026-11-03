import { WalletAccount } from "../models/balance.model.js";
import { WalletDeduction } from "../models/walletDeduction.model.js";

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
      $inc: { cents: -cents },
      $set: { updated_at: new Date() },
    },
    {
      returnDocument: "after",
      upsert: false,
    },
  ).exec();

  return account?.cents ?? null;
}

export type DeductBalanceOnceResult =
  | {
      ok: true;
      remainingBalance: bigint;
      alreadyDeducted: boolean;
    }
  | {
      ok: false;
      reason: "missing" | "insufficient";
    };

export function walletDeductionMatches(
  deduction: { uid: string; cents: bigint },
  uid: string,
  cents: bigint,
): boolean {
  return deduction.uid === uid && deduction.cents === cents;
}

export function getWalletDeductionFailureReason(
  walletExists: boolean,
): "missing" | "insufficient" {
  return walletExists ? "insufficient" : "missing";
}

export async function deductBalanceOnce(
  uid: string,
  cents: bigint,
  checkoutId: string,
): Promise<DeductBalanceOnceResult> {
  const session = await WalletAccount.db.startSession();
  let result: DeductBalanceOnceResult | null = null;

  const readExistingDeduction = async () => {
    const deduction = await WalletDeduction.findById(checkoutId).lean().exec();

    if (!deduction) return null;
    if (!walletDeductionMatches(deduction, uid, cents)) {
      throw new Error(
        `Wallet deduction key ${checkoutId} was reused with different payment details.`,
      );
    }

    const account = await WalletAccount.findById(uid)
      .select({ cents: 1 })
      .lean()
      .exec();

    return {
      ok: true as const,
      remainingBalance: account?.cents ?? 0n,
      alreadyDeducted: true,
    };
  };

  try {
    await session.withTransaction(async () => {
      const existing = await WalletDeduction.findById(checkoutId)
        .session(session)
        .lean()
        .exec();

      if (existing) {
        if (!walletDeductionMatches(existing, uid, cents)) {
          throw new Error(
            `Wallet deduction key ${checkoutId} was reused with different payment details.`,
          );
        }

        const account = await WalletAccount.findById(uid)
          .select({ cents: 1 })
          .session(session)
          .lean()
          .exec();

        result = {
          ok: true,
          remainingBalance: account?.cents ?? 0n,
          alreadyDeducted: true,
        };
        return;
      }

      const account = await WalletAccount.findOneAndUpdate(
        {
          _id: uid,
          cents: { $gte: cents },
        },
        {
          $inc: { cents: -cents },
          $set: { updated_at: new Date() },
        },
        {
          returnDocument: "after",
          upsert: false,
          session,
        },
      ).exec();

      if (!account) {
        const exists = await WalletAccount.exists({ _id: uid }).session(
          session,
        );
        result = {
          ok: false,
          reason: getWalletDeductionFailureReason(Boolean(exists)),
        };
        return;
      }

      await WalletDeduction.create(
        [
          {
            _id: checkoutId,
            uid,
            cents,
          },
        ],
        { session },
      );

      result = {
        ok: true,
        remainingBalance: account.cents ?? 0n,
        alreadyDeducted: false,
      };
    });
  } catch (error) {
    const existing = await readExistingDeduction();
    if (existing) return existing;
    throw error;
  } finally {
    await session.endSession();
  }

  if (!result) {
    throw new Error("Wallet deduction transaction completed without a result.");
  }

  return result;
}
