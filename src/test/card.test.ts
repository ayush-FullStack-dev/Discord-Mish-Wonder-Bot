import { connectDatabase } from "../config/database.js";
import { getCards } from "../services/card.service.js";
import { decrypt } from "../utils/encryption.js";

await connectDatabase();

const result = await getCards({
  status: "active",
});

const cards = await getCards({
  status: "active",
  lastUsedBy: { $ne: null },
})

console.log(
  cards.data?.map((card) => ({
    ...card,
    encryptedCardNumber: decrypt(card.encryptedCardNumber),
    encryptedCardCvv: decrypt(card.encryptedCardCvv),
  })),
);

console.log("Total Active Cards:", result.data?.length ?? 0);
