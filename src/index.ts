import { Client, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import {
  errorLog,
  info,
  success,
} from "../logs/printLogs.js";
import { registerInteractionHandler } from "./handlers/interaction-handler.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

registerInteractionHandler(client);

client.once("clientReady", (readyClient) => {
  success(`Logged in as ${readyClient.user.tag}`);
  info(`Bot ID: ${readyClient.user.id}`);
  info(`Environment: ${env.nodeEnv}`);
});

client.on("error", (error) => {
  errorLog(`Discord client error: ${error}`);
  process.exitCode = 1;
});

client.login(env.discordToken).catch((error: unknown) => {
  errorLog(`Failed to log in to Discord: ${error}`);
  process.exitCode = 1;
});