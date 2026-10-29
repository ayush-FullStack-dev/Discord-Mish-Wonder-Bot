import cron from "node-cron";
import { Order } from "../models/order.model.js";
import { Card } from "../models/card.model.js";

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
        status: "pending",
        expiresAt: { $gt: now },
      }).distinct("card");

      const activeCardIds = new Set(activeOrders.map((id) => id.toString()));

      const unlockCardIds = cardIds.filter(
        (id) => !activeCardIds.has(id.toString()),
      );

      if (unlockCardIds.length) {
        await Card.updateMany(
          {
            _id: { $in: unlockCardIds },
            isLocked: true,
          },
          { $set: { isLocked: false } },
        );
      }
    } catch {}
  });
}
