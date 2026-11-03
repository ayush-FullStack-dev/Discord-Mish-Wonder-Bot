import { getChains } from "../services/account.service.js";
import { UserChain } from "../models/userChain.model.js";
import type { Chain } from "../types/index.js";

type ChainSelectionMode =
  | "first_credit"
  | "has_credit"
  | "most_credit"
  | "most_unused_credit";

function getAvailableCredit(chain: Chain): number {
  return chain.credit
    .filter((item) => !item.used)
    .reduce((total, item) => total + item.credit, 0);
}

function getTotalCredit(chain: Chain): number {
  return chain.credit.reduce((total, item) => total + item.credit, 0);
}

export async function getBestChain(
  mode: ChainSelectionMode = "first_credit",
): Promise<string> {
  try {
    const data = await getChains();
    const chains: Chain[] = data.chains ?? [];

    let selectedChain: Chain | undefined;

    switch (mode) {
      case "first_credit":
        selectedChain = chains.find(
          (chain) => chain.credit.length > 0,
        );
        break;

      case "has_credit":
        selectedChain = chains.find(
          (chain) => getAvailableCredit(chain) > 0,
        );
        break;

      case "most_credit":
        selectedChain = chains
          .filter((chain) => chain.credit.length > 0)
          .toSorted(
            (a, b) => getTotalCredit(b) - getTotalCredit(a),
          )[0];
        break;

      case "most_unused_credit":
        selectedChain = chains
          .filter((chain) => getAvailableCredit(chain) > 0)
          .toSorted(
            (a, b) =>
              getAvailableCredit(b) - getAvailableCredit(a),
          )[0];
        break;
    }

    if (selectedChain?.chain) {
      return String(selectedChain.chain);
    }
  } catch (error) {
    console.error("Failed to fetch chains from API:", error);
  }

  try {
    const oldChain = await UserChain.findOne()
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    return String(oldChain?.lastChain || "1");
  } catch (error) {
    console.error("Failed to fetch last chain from database:", error);
  }

  return "1";
}