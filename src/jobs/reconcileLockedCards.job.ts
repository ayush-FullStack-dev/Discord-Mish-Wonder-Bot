import cron from "node-cron";
import { Order } from "../models/order.model.js";
import { Card } from "../models/card.model.js";
import { releaseCardLockIfUnused } from "../services/card.service.js";

export function startReconcileLockedCardsJob() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const lockedCards = await Card.find({ isLocked: true })
        .select("_id")
        .lean();

      if (!lockedCards.length) return;

      const cardIds = lockedCards.map((card) => card._id);
      const now = new Date();

      const activeOrders = await Order.find({
        card: { $in: cardIds },
        $or: [
          { status: "unknown" },
          { status: "pending", $or: [{ confirming: true }, { expiresAt: { $gt: now } }, { expiresAt: null }] },
        ],
      }).distinct("card");

      const activeCardIds = new Set(activeOrders.map((id) => id.toString()));

      const unlockCardIds = cardIds.filter(
        (id) => !activeCardIds.has(id.toString()),
      );

      if (unlockCardIds.length) {
        for (const id of unlockCardIds) await releaseCardLockIfUnused(id);
      }
    } catch {}
  });
}
