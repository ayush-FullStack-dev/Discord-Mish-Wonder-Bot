import cron from "node-cron";
import {
  createAccountsOnChain,
  getChains,
} from "../services/account.service.js";
import { excludeChains, minChainAccountCount } from "../constants/constant.js";
import { success, errorLog } from "../../logs/printLogs.js";

type Ichain = {
  chain: string;
  accounts: number;
  unused: number;
  locked: boolean;
  next_account: string;
  ready: boolean;
};

export function accountProvisioning() {
  let isRunning = false;

  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) return;

    isRunning = true;

    try {
      const response = await getChains();

      if (!response?.ok || !Array.isArray(response.chains)) {
        throw new Error("Failed to fetch chains");
      }

      const incompleteChains = response.chains
        .filter(
          (chainInfo: Ichain) =>
            !chainInfo.ready ||
            chainInfo.accounts < minChainAccountCount ||
            chainInfo.unused < minChainAccountCount,
        )
        .map((chainInfo: Ichain) => ({
          id: chainInfo.chain,
          accounts: chainInfo.accounts,
          unused: chainInfo.unused,
        }));

      if (!incompleteChains.length) return;

      let created = 0;
      let failed = 0;
      let totalAccounts = 0;

      for (const chainInfo of incompleteChains) {
        if (excludeChains.includes(chainInfo.id)) continue;

        const missingAccounts = Math.max(
          0,
          minChainAccountCount - chainInfo.accounts,
          minChainAccountCount - chainInfo.unused,
        );

        if (!missingAccounts) continue;

        const result = await createAccountsOnChain({
          chain: chainInfo.id,
          count: missingAccounts,
        });

        if (!result.ok) {
          failed++;

          errorLog(`[CRON] Chain ${chainInfo.id}: ${result.error}`);

          continue;
        }

        created++;
        totalAccounts += missingAccounts;
      }

      if (created || failed) {
        (failed ? errorLog : success)(
          `[CRON] Provisioning | Created: ${created} | Failed: ${failed} | Accounts: ${totalAccounts}`,
        );
      }
    } catch (error) {
      errorLog(
        `[CRON] Account provisioning error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      isRunning = false;
    }
  });
}
