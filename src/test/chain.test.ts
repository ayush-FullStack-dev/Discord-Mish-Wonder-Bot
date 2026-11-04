import { getChains } from "../services/account.service.js";

const chains = await getChains();

console.log(chains)