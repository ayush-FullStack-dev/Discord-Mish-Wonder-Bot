import { Client, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import { errorLog, info, printASCII, success } from "../logs/printLogs.js";
import { registerInteractionHandler } from "./handlers/interaction-handler.js";
import { connectDatabase } from "./config/database.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

registerInteractionHandler(client);

client.once("clientReady", (readyClient) => {
  success(`Logged in as ${readyClient.user.tag}`);
  info(`Bot ID: ${readyClient.user.id}`);
  info(`Environment: ${env.nodeEnv}`);
  printASCII(readyClient.user.displayName);
});

client.on("error", (error) => {
  errorLog(`Discord client error: ${error}`);
  process.exitCode = 1;
});

async function main() {
  await connectDatabase();
  success("Database connection established.");
  await client.login(env.discordToken);
}

main().catch((error: unknown) => {
  errorLog(`Application startup failed: ${error}`);
  process.exitCode = 1;
});
