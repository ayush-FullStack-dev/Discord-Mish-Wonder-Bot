import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { Order } from "../models/order.model.js";
import { OrderConfirmation } from "../models/orderConfirmation.model.js";
import { Card } from "../models/card.model.js";
import { deductBalanceOnce } from "./balance.service.js";
import { confirmOrder } from "./order.service.js";
import { dollarsToCents } from "../utils/util.js";

export function confirmationLog(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...details }, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() :
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value));
}

export function claimFilter(id: string, userId: string, admin: boolean) {
  return {
    _id: id, status: "pending" as const, confirming: false,
    ...(admin ? {} : { discordUserId: userId }),
  };
}

export function ownedFilter(id: Types.ObjectId, token: string) {
  return { _id: id, status: "pending" as const, confirming: true, confirmationToken: token };
}

export const newConfirmationToken = randomUUID;

export async function releaseConfirmation(id: Types.ObjectId, token: string) {
  const result = await Order.updateOne(ownedFilter(id, token), {
    $set: { confirming: false, confirmationToken: null },
  });
  confirmationLog("confirmation.release", { localOrderId: id, mongoResult: result,
    matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
}

export async function confirmClaimedOrder(id: Types.ObjectId, token: string, checkoutId: string) {
  const order = await Order.findOne({ ...ownedFilter(id, token), checkoutId });
  if (!order) throw new Error("Confirmation ownership or checkout changed.");
  // Persist intent before the external side effect. A crash/timeout is NOT a rejection.
  const intent = await OrderConfirmation.findOneAndUpdate(
    { _id: id, state: "rejected" },
    { $set: { token, discordUserId: order.discordUserId, checkoutId,
      total: order.total, card: order.card, state: "requesting" } },
    { returnDocument: "after", writeConcern: { w: "majority" } },
  );
  if (!intent) {
    await OrderConfirmation.create([{ _id: id, token, discordUserId: order.discordUserId,
      checkoutId, total: order.total, card: order.card ?? null, state: "requesting" }],
    { w: "majority" });
  }
  const result = await confirmOrder(checkoutId);
  if (!result.ok) {
    if (result.code === "PAYMENT_ERROR") {
      const rejection = await OrderConfirmation.updateOne({ _id: id, token, state: "requesting" },
        { $set: { state: "rejected" } }, { writeConcern: { w: "majority" } });
      if (rejection.matchedCount !== 1) throw new Error("Payment rejection could not be recorded safely.");
      return result;
    }
    throw new Error("Provider confirmation outcome requires reconciliation; do not resubmit.");
  }
  const data = result.data;
  const receipt = { providerOrderId: data.order_id, cost: data.price?.total,
    trackingUrl: data.tracking ?? null };
  confirmationLog("confirmation.provider_confirmed", { localOrderId: id, checkoutId,
    status: order.status, confirming: order.confirming, total: order.total, ...receipt });
  if (typeof receipt.providerOrderId !== "string" || !receipt.providerOrderId ||
      typeof receipt.cost !== "number" || !Number.isFinite(receipt.cost)) {
    throw new Error("Provider success response requires manual reconciliation; invalid ID or cost.");
  }
  const saved = await OrderConfirmation.updateOne({ _id: id, token, state: "requesting" },
    { $set: { ...receipt, state: "confirmed" } }, { writeConcern: { w: "majority" } });
  if (saved.matchedCount !== 1) throw new Error("Provider receipt could not be persisted.");
  return result;
}

export async function settleConfirmation(id: Types.ObjectId) {
  const receipt = await OrderConfirmation.findById(id);
  if (!receipt || !["confirmed", "settled"].includes(receipt.state)) {
    throw new Error("No verified provider confirmation to settle.");
  }
  const context = { localOrderId: id, providerOrderId: receipt.providerOrderId,
    checkoutId: receipt.checkoutId };
  const result = await Order.updateOne({ ...ownedFilter(id, receipt.token),
    discordUserId: receipt.discordUserId, checkoutId: receipt.checkoutId }, {
    $set: { status: "confirmed", confirming: false, confirmationToken: null,
      orderId: receipt.providerOrderId, cost: receipt.cost, trackingUrl: receipt.trackingUrl,
      total: receipt.total, expiresAt: null },
  }, { writeConcern: { w: "majority" }, runValidators: true });
  const current = await Order.findById(id);
  confirmationLog("confirmation.persist", { ...context, mongoResult: result,
    matchedCount: result.matchedCount, modifiedCount: result.modifiedCount,
    status: current?.status ?? null, confirming: current?.confirming ?? null });
  if (!current || current.status !== "confirmed" || current.orderId !== receipt.providerOrderId ||
      current.discordUserId !== receipt.discordUserId || current.total !== receipt.total ||
      current.checkoutId !== receipt.checkoutId) {
    throw new Error("Confirmed provider receipt retained: local order needs reconciliation.");
  }
  if (receipt.card && result.modifiedCount === 1) {
    await Card.updateOne({ _id: receipt.card },
      { $set: { isLocked: false, lastUsedBy: receipt.discordUserId } });
  }
  const wallet = await deductBalanceOnce(receipt.discordUserId,
    dollarsToCents(receipt.total), `order:${id.toString()}`).catch((error: unknown) => {
      confirmationLog("confirmation.wallet_error", { ...context, status: current.status,
        confirming: current.confirming, walletDeductionResult: "unknown; retry with same key", error });
      throw error;
    });
  confirmationLog("confirmation.wallet", { ...context, status: current.status,
    confirming: current.confirming, walletDeductionResult: wallet });
  if (!wallet.ok) throw new Error(`Confirmed order wallet reconciliation required: ${wallet.reason}`);
  await OrderConfirmation.updateOne({ _id: id, state: "confirmed" }, { $set: { state: "settled" } });
  return wallet.remainingBalance;
}

export async function releaseRecoverableConfirmation(id: Types.ObjectId, token: string) {
  const receipt = await OrderConfirmation.findById(id);
  if (!receipt || receipt.state === "rejected") {
    await releaseConfirmation(id, token);
  } else if (receipt.state === "requesting") {
    confirmationLog("confirmation.reconciliation_required", { localOrderId: id,
      checkoutId: receipt.checkoutId, providerOrderId: receipt.providerOrderId,
      reason: "Provider outcome unknown; lock retained, automatic resubmission prohibited" });
  }
}