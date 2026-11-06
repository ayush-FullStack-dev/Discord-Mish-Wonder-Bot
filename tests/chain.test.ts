import { connectDatabase } from "../src/config/database.js";
import { getChains } from "../src/services/account.service.js";
import { getBestChain } from "../src/utils/chain.js";

connectDatabase()
  .then(() => console.log("Connected to database"))
  .catch((err) => console.error("Database connection error:", err));

const chainId = await getBestChain("most_unused_credit");
const chains = await getChains();

console.log(chains, chainId);
