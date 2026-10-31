import axios from "axios";
import { env } from "../config/env.js";
import { Card } from "../models/card.model.js";
import { Order } from "../models/order.model.js";
import { encrypt } from "../utils/encryption.js";
import type { QueryFilter } from "mongoose";
import type { Types } from "mongoose";
import type { ICard } from "../types/index.js";
import { getCardExpirationDate } from "../utils/util.js";

export function createCardLockOwnerFilter(
  cardId: Types.ObjectId | string,
  now: Date,
) {
  return {
    card: cardId,
    $or: [
      { status: "unknown" as const },
      {
        status: "pending" as const,
        $or: [
          { confirming: true },
          { expiresAt: { $gt: now } },
          { expiresAt: null },
        ],
      },
    ],
  };
}

export async function releaseCardLockIfUnused(
  cardId: Types.ObjectId | string | null | undefined,
): Promise<boolean> {
  if (!cardId) return false;

  const activeOrder = await Order.exists(
    createCardLockOwnerFilter(cardId, new Date()),
  );

  if (activeOrder) return false;

  const released = await Card.updateOne(
    {
      _id: cardId,
      isLocked: true,
      reconciliationCheckoutId: null,
    },
    { $set: { isLocked: false } },
  );
  return released.modifiedCount === 1;
}

function handleDatabaseError(error: unknown): never {
  if (error instanceof Error) {
    throw new Error(`Database error: ${error.message}`);
  }

  throw new Error("An unexpected database error occurred.");
}

export async function addCard(payload: ICard) {
  try {
    const data = await Card.create({
      ...payload,
      encryptedCardNumber: encrypt(payload.encryptedCardNumber),
      encryptedCardCvv: encrypt(payload.encryptedCardCvv),
      last4Digits: payload.encryptedCardNumber.slice(-4),
      expiresAt: getCardExpirationDate(payload.expiryDate),
    });

    return {
      ok: !!data,
      data,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}

export async function addManyCards(payload: ICard[]) {
  try {
    const cards = payload.map((card) => ({
      ...card,
      encryptedCardNumber: encrypt(card.encryptedCardNumber),
      encryptedCardCvv: encrypt(card.encryptedCardCvv),
      last4Digits: card.encryptedCardNumber.slice(-4),
      expiresAt: getCardExpirationDate(card.expiryDate),
    }));

    const data = await Card.insertMany(cards);

    return {
      ok: data.length >= 1,
      acceptedCount: data.length,
      rejectedCount: payload.length - data.length,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}

export async function getCards(condition: QueryFilter<ICard>) {
  try {
    const data = await Card.find(condition);

    return {
      ok: true,
      data,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}

export async function burnCard(last4: string) {
  try {
    if (!/^\d{4}$/.test(last4)) {
      throw new Error("last4 must contain exactly 4 digits.");
    }
    const data = await Card.findOneAndDelete({ last4Digits: last4 });

    return {
      ok: !!data,
      data,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}

export async function deleteCards() {
  try {
    const data = await Card.deleteMany({});

    return {
      ok: data.acknowledged,
      deletedCount: data.deletedCount,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}

export async function pinCard(last4: string) {
  try {
    if (!/^\d{4}$/.test(last4)) {
      throw new Error("last4 must contain exactly 4 digits.");
    }

    const data = await Card.findOneAndUpdate(
      { last4Digits: last4 },
      {
        isPin: true,
      },
      {
        returnDocument: "after",
      },
    );

    return {
      ok: !!data,
      data,
    };
  } catch (error: unknown) {
    handleDatabaseError(error);
  }
}
