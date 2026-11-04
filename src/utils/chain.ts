import { getChains, getAccounts } from "../services/account.service.js";

import { UserChain } from "../models/userChain.model.js";
import type { Chain } from "../types/index.js";
import { excludeChains } from "../constants/constant.js";

type ChainSelectionMode =
  | "first_credit"
  | "has_credit"
  | "most_credit"
  | "most_unused_credit"
  | "most_unused";

interface Account {
  chain: string | null;
  credit: number;
  state: string;
  active_order: boolean;
  can_order: boolean;
}

interface ChainAccountStats {
  totalCredit: number;
  availableCredit: number;
}

async function getDatabaseFallback(): Promise<string> {
  try {
    const oldChain = await UserChain.findOne({
      lastChain: {
        $nin: excludeChains,
        $exists: true,
        $ne: null,
      },
    })
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    return oldChain?.lastChain ? String(oldChain.lastChain) : "2";
  } catch {
    return "2";
  }
}

function getAccountStats(accounts: Account[]): Map<string, ChainAccountStats> {
  const stats = new Map<string, ChainAccountStats>();

  for (const account of accounts) {
    if (!account.chain || !account.can_order) continue;

    const credit = Number(account.credit);

    if (!Number.isFinite(credit) || credit <= 0) continue;

    const chainId = String(account.chain);

    const current = stats.get(chainId) ?? {
      totalCredit: 0,
      availableCredit: 0,
    };

    current.totalCredit += credit;

    if (!account.active_order) {
      current.availableCredit += credit;
    }

    stats.set(chainId, current);
  }

  return stats;
}

export async function getBestChain(
  mode: ChainSelectionMode = "most_unused_credit",
): Promise<string> {
  let chainData;
  let accountData;

  try {
    [chainData, accountData] = await Promise.all([getChains(), getAccounts()]);

    if (
      !chainData?.ok ||
      !Array.isArray(chainData.chains) ||
      !accountData?.ok ||
      !Array.isArray(accountData.accounts)
    ) {
      throw new Error("Invalid chains or accounts API response.");
    }
  } catch {
    return getDatabaseFallback();
  }

  const allChains: Chain[] = chainData.chains;
  const accounts: Account[] = accountData.accounts;

  const chains = allChains.filter(
    (chain) =>
      chain.locked === false &&
      chain.ready === true &&
      !excludeChains.includes(String(chain.chain)),
  );
  const accountStats = getAccountStats(accounts);

  const getStats = (chain: Chain): ChainAccountStats =>
    accountStats.get(String(chain.chain)) ?? {
      totalCredit: 0,
      availableCredit: 0,
    };

  const priority: ChainSelectionMode[] = [
    mode,
    ...(
      [
        "most_unused_credit",
        "most_credit",
        "has_credit",
        "first_credit",
        "most_unused",
      ] as ChainSelectionMode[]
    ).filter((item) => item !== mode),
  ];

  try {
    for (const strategy of priority) {
      let selectedChain: Chain | undefined;

      switch (strategy) {
        case "most_unused_credit":
          selectedChain = chains
            .filter((chain) => getStats(chain).availableCredit > 0)
            .sort(
              (a, b) =>
                getStats(b).availableCredit - getStats(a).availableCredit,
            )[0];
          break;

        case "most_credit":
          selectedChain = chains
            .filter((chain) => getStats(chain).totalCredit > 0)
            .sort(
              (a, b) => getStats(b).totalCredit - getStats(a).totalCredit,
            )[0];
          break;

        case "has_credit":
          selectedChain = chains.find(
            (chain) => getStats(chain).availableCredit > 0,
          );
          break;

        case "first_credit":
          selectedChain = chains.find(
            (chain) => getStats(chain).totalCredit > 0,
          );
          break;

        case "most_unused":
          selectedChain = chains
            .filter((chain) => chain.unused > 0)
            .sort((a, b) => b.unused - a.unused)[0];
          break;
      }

      if (selectedChain?.chain) {
        return String(selectedChain.chain);
      }
    }
  } catch {
    return getDatabaseFallback();
  }

  return getDatabaseFallback();
}