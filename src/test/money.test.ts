import { connectDatabase } from "../config/database.js";
import { getBalance, updateBalance } from "../services/balance.service.js";

await connectDatabase();

const uid = "1079583397606866985";
const amount = 4; // Amount to add in USD (dollars)

const before = await getBalance(uid);

if (before === null) {
  console.log("Wallet account not found.");
  process.exit(1);
}

const updatedBalance = BigInt(before) - BigInt(amount * 100);
const updated = await updateBalance(uid, updatedBalance);

console.log(updated);
console.log("========== BALANCE INCREASED ==========");
console.log(`Previous: $${(Number(before) / 100).toFixed(2)}`);
console.log(`Added:    $${amount.toFixed(2)}`);
console.log(`Final:    $${(Number(updated!) / 100).toFixed(2)}`);
console.log("========================================");
