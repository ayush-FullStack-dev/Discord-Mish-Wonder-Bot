import { connectDatabase } from "../config/database.js";
import { getBalance, updateBalance } from "../services/balance.service.js";

await connectDatabase();

const uid = "1525807833277268060";
const amount = 40; // Final balance in USD

const before = await getBalance(uid);

if (before === null) {
  console.log("Wallet account not found.");
  process.exit(1);
}

const updated = await updateBalance(uid, BigInt(amount * 100));

console.log("========== BALANCE UPDATED ==========");
console.log(`Previous: $${(Number(before) / 100).toFixed(2)}`);
console.log(`Final:    $${(Number(updated!) / 100).toFixed(2)}`);
console.log("====================================");
