import { connectDatabase } from "../config/database.js";
import {
  createAccountsOnChain,
  getChains,
} from "../services/account.service.js";
import { getBestChain } from "../utils/chain.js";

connectDatabase()
  .then(() => console.log("Connected to database"))
  .catch((err) => console.error("Database connection error:", err));

const chainId = await getBestChain("most_unused_credit");
const chains = await getChains();

// createAccountsOnChain({ chain: "11", count: 2 });
console.log(chains, chainId);
