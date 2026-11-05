import { connectDatabase } from "../config/database.js";
import { getCards } from "../services/card.service.js";

await connectDatabase();

const result = await getCards({
  status: "active",
});

console.log("Total Active Cards:", result.data?.length ?? 0);
