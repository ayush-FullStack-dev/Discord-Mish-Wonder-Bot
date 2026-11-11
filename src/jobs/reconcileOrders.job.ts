import cron from "node-cron";
import { OrderConfirmation } from "../models/orderConfirmation.model.js";
import { confirmationLog, settleConfirmation } from "../services/order-confirmation.service.js";

export function startReconcileOrdersJob() {
  cron.schedule("* * * * *", async () => {
    try {
      for await (const receipt of OrderConfirmation.find({ state: "confirmed" }).cursor()) {
        try {
          await settleConfirmation(receipt._id);
        } catch (error) {
          confirmationLog("confirmation.recovery_failed", { localOrderId: receipt._id,
            providerOrderId: receipt.providerOrderId, checkoutId: receipt.checkoutId, error });
        }
      }
      for await (const receipt of OrderConfirmation.find({ state: "requesting",
        updatedAt: { $lt: new Date(Date.now() - 15 * 60_000) } }).cursor()) {
        confirmationLog("confirmation.manual_reconciliation_required", {
          localOrderId: receipt._id, checkoutId: receipt.checkoutId,
          reason: "Provider outcome unknown. Verify with provider; never blindly retry or debit.",
        });
      }
    } catch (error) {
      confirmationLog("confirmation.recovery_job_failed", { error });
    }
  });
}