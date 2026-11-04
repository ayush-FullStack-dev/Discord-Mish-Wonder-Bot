import { connectDatabase } from "../config/database.js";
import { getCards } from "../services/card.service.js";
import { decrypt } from "../utils/encryption.js";

connectDatabase();

const result = await getCards({
  status: "active",
  lastUsedBy: { $ne: null },
});

const cards = result.data?.map((card) => ({
  ...card,
  encryptedCardNumber: decrypt(card.encryptedCardNumber),
  encryptedCardCvv: decrypt(card.encryptedCardCvv),
}));

console.log(cards);
