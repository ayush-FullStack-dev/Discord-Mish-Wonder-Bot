import cron from "node-cron";
import { OrderConfirmation } from "../models/orderConfirmation.model.js";
import { settleConfirmation } from "../services/order-confirmation.service.js";

export function startReconcileOrdersJob() {
  cron.schedule("* * * * *", async () => {
    try {
      for await (const receipt of OrderConfirmation.find({
        state: "confirmed",
      }).cursor()) {
        try {
          await settleConfirmation(receipt._id);
        } catch {
          // Retry automatically on the next scheduled run.
        }
      }

      const staleRequests = OrderConfirmation.find({
        state: "requesting",
        updatedAt: { $lt: new Date(Date.now() - 15 * 60_000) },
      }).cursor();

      for await (const receipt of staleRequests) {
        // Manual reconciliation required. Never blindly retry.
      }
    } catch {
      // Job will run again on the next scheduled interval.
    }
  });
}
