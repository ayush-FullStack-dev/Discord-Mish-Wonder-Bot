import { connectDatabase } from "../src/config/database.js";
import { getCards } from "../src/services/card.service.js";

await connectDatabase();

const result = await getCards({
  status: "active",
});

console.log("Total Active Cards:", result.data?.length ?? 0);
