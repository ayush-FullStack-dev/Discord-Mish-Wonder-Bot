import "dotenv/config";
import { errorLog } from "../../logs/printLogs.js";
import { get } from "node:http";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    errorLog(`Missing required environment variable: ${name}`);
    process.exitCode = 1;
    return "";
  }

  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  discordToken: getRequiredEnv("DISCORD_TOKEN"),
  shopChannelId: getRequiredEnv("SHOP_CHANNELID"),
  yonderApiBaseUrl: getRequiredEnv("YONDER_API_BASE_URL"),
  mongodbUri: getRequiredEnv("MONGODB_URI"),
  orderTicketCategoryId: getRequiredEnv("ORDER_TICKET_CATEGORY_ID"),
  yonderApiKey: getRequiredEnv("YONDER_API_KEY"),
  encryptionKey: getRequiredEnv("ENCRYPTION_KEY"),
  clientId: getRequiredEnv("CLIENT_ID"),
  guildId: getRequiredEnv("GUILD_ID"),
} as const;
