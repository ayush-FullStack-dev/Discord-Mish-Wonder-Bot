import { Client, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import { info, printASCII, success } from "../logs/printLogs.js";
import { registerInteractionHandler } from "./handlers/interaction-handler.js";
import { connectDatabase } from "./config/database.js";
import mongoose from "mongoose";
import {
  logApplicationError,
  registerGlobalErrorHandlers,
} from "./utils/error-handler.js";
import { startExpireOrdersJob } from "./jobs/expireOrders.job.js";
import { startReconcileLockedCardsJob } from "./jobs/reconcileLockedCards.job.js";
import { accountProvisioning } from "./jobs/accountProvisioning.cron.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

registerInteractionHandler(client);

const handleFatalError = registerGlobalErrorHandlers(async () => {
  try {
    client.destroy();
  } finally {
    await mongoose.disconnect();
  }
});

client.once("clientReady", (readyClient) => {
  success(`Logged in as ${readyClient.user.tag}`);
  info(`Bot ID: ${readyClient.user.id}`);
  info(`Environment: ${env.nodeEnv}`);
  printASCII(readyClient.user.displayName);
});

client.on("error", (error) => {
  logApplicationError("Discord client error", error);
  process.exitCode = 1;
});

async function main() {
  await connectDatabase();
  success("Database connection established.");

  startExpireOrdersJob();
  startReconcileLockedCardsJob();
  accountProvisioning();
  await client.login(env.discordToken);
}

main().catch((error: unknown) => {
  handleFatalError("Application startup failed", error);
});
