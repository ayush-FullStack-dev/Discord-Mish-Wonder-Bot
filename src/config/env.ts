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

function getNumberEnv(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    errorLog(`Invalid numeric environment variable: ${name}`);
    process.exitCode = 1;
    return defaultValue;
  }

  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  discordToken: getRequiredEnv("DISCORD_TOKEN"),
  shopChannelId: getRequiredEnv("SHOP_CHANNELID"),
  yonderApiBaseUrl: getRequiredEnv("YONDER_API_BASE_URL"),
  mongodbUri: getRequiredEnv("MONGODB_URI"),
  orderTicketCategoryId: getRequiredEnv("ORDER_TICKET_CATEGORY_ID"),
  successChannelId: getRequiredEnv("SUCCESS_CHANNEL_ID"),
  errorChannelId: getRequiredEnv("ERROR_CHANNEL_ID"),
  yonderApiKey: getRequiredEnv("YONDER_API_KEY"),
  encryptionKey: getRequiredEnv("ENCRYPTION_KEY"),
  clientId: getRequiredEnv("CLIENT_ID"),
  guildId: getRequiredEnv("GUILD_ID"),
  minimumOrderSubTotal: getNumberEnv("MINIMUM_ORDER_SUBTOTAL", 20),
  maxOrderAmount: getNumberEnv("MAX_ORDER_AMOUNT", 25),
  maxChainAccounts: getNumberEnv("MAX_CHAIN_ACCOUNTS", 30),
} as const;
