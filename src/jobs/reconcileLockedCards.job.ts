import cron from "node-cron";
import type { Client } from "discord.js";
import { Card } from "../models/card.model.js";
import { Order } from "../models/order.model.js";
import { WalletDeduction } from "../models/walletDeduction.model.js";
import { logError } from "../utils/logger.js";
import { dollarsToCents } from "../utils/util.js";
import { releaseCardLockIfUnused } from "../services/card.service.js";
import { getStaleConfirmationAction } from "../services/order-confirmation-state.js";
import { walletDeductionMatches } from "../services/balance.service.js";

const STALE_CONFIRMATION_MS = 60_000;

async function recoverStaleConfirmations(client: Client): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_CONFIRMATION_MS);

  const abandonedClaims = await Order.find({
    status: "pending",
    confirming: true,
    confirmationState: "claimed",
    confirmationStartedAt: { $lte: staleBefore },
  })
    .select(
      "_id checkoutId confirmationToken confirmationExpiresAt discordUserId",
    )
    .lean()
    .exec();

  for (const order of abandonedClaims) {
    if (getStaleConfirmationAction(order.confirmationState) !== "release") {
      continue;
    }

    const updated = await Order.collection.updateOne(
      {
        _id: order._id,
        status: "pending",
        confirming: true,
        confirmationState: "claimed",
        confirmationToken: order.confirmationToken ?? null,
      },
      {
        $set: {
          confirming: false,
          confirmationState: null,
          confirmationToken: null,
          confirmationStartedAt: null,
          expiresAt: order.confirmationExpiresAt ?? null,
          confirmationExpiresAt: null,
        },
      },
    );

    if (updated.matchedCount) {
      await logError(
        client,
        "Stale Confirmation Lock Released",
        "Confirmation stopped before the provider request was started.",
        {
          User: order.discordUserId,
          "Checkout ID": order.checkoutId,
        },
      );
    }
  }

  const uncertainConfirmations = await Order.find({
    status: "pending",
    confirming: true,
    confirmationState: {
      $in: ["provider_requested", "cancel_requested", null],
    },
    $or: [
      { confirmationStartedAt: { $lte: staleBefore } },
      { confirmationStartedAt: null },
    ],
  })
    .select("_id checkoutId confirmationToken discordUserId")
    .lean()
    .exec();

  for (const order of uncertainConfirmations) {
    if (
      getStaleConfirmationAction(order.confirmationState) !== "mark_unknown"
    ) {
      continue;
    }

    const updated = await Order.collection.updateOne(
      {
        _id: order._id,
        status: "pending",
        confirming: true,
        confirmationState: {
          $in: ["provider_requested", "cancel_requested", null],
        },
        confirmationToken: order.confirmationToken ?? null,
      },
      {
        $set: {
          status: "unknown",
          confirming: false,
          confirmationState: "unknown",
          confirmationToken: null,
          confirmationStartedAt: null,
          confirmationExpiresAt: null,
          expiresAt: null,
        },
      },
    );

    if (updated.matchedCount) {
      await logError(
        client,
        "Provider Order Status Requires Reconciliation",
        "The process stopped after a provider request may have been processed. The order was made non-retryable and its card remains locked pending manual status verification.",
        {
          User: order.discordUserId,
          "Checkout ID": order.checkoutId,
        },
      );
    }
  }
}

async function reconcileRecordedWalletDeductions(
  client: Client,
): Promise<void> {
  const orders = await Order.find({
    status: "confirmed",
    paymentStatus: "reconciliation_required",
  })
    .select("_id checkoutId discordUserId total")
    .lean();

  for (const order of orders) {
    const deduction = await WalletDeduction.findById(order.checkoutId)
      .lean()
      .exec();
    if (
      !deduction ||
      !walletDeductionMatches(
        deduction,
        order.discordUserId,
        dollarsToCents(order.total),
      )
    ) {
      continue;
    }

    try {
      const updated = await Order.collection.updateOne(
        {
          _id: order._id,
          status: "confirmed",
          paymentStatus: "reconciliation_required",
        },
        { $set: { paymentStatus: "paid" } },
      );
      if (!updated.matchedCount) {
        await logError(
          client,
          "Wallet Payment Reconciliation Failed",
          "The wallet deduction exists, but its order record was not updated.",
          {
            User: order.discordUserId,
            "Checkout ID": order.checkoutId,
          },
        );
      }
    } catch (error) {
      await logError(
        client,
        "Wallet Payment Reconciliation Failed",
        error,
        {
          User: order.discordUserId,
          "Checkout ID": order.checkoutId,
        },
      );
    }
  }
}

export function startReconcileLockedCardsJob(client: Client) {
  cron.schedule("* * * * *", async () => {
    try {
      await recoverStaleConfirmations(client);
      await reconcileRecordedWalletDeductions(client);
    } catch (error) {
      await logError(client, "Order Reconciliation Job Failed", error);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    try {
      const lockedCards = await Card.find({ isLocked: true })
        .select("_id")
        .lean();

      for (const { _id } of lockedCards) {
        await releaseCardLockIfUnused(_id);
      }
    } catch (error) {
      await logError(client, "Card Lock Reconciliation Failed", error);
    }
  });
}
