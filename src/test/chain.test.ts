import { connectDatabase } from "../config/database.js";
import {
  createAccountsOnChain,
  getChains,
} from "../services/account.service.js";
import { getBestChain } from "../utils/chain.js";

connectDatabase()
  .then(() => console.log("Connected to database"))
  .catch((err) => console.error("Database connection error:", err));

const chainId = await getBestChain("most_unused_credit") || "11"
const chains = await getChains();

// createAccountsOnChain({ chain: chainId, count: 1 });
console.log(chains, chainId);
