import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";
import { postShopCommand } from "./commands/post-shop.js";
import { errorLog, info, success } from "../logs/printLogs.js";
import { addBulkCardsCommand, addCardCommand } from "./commands/card-mange.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency and connection status."),
  postShopCommand,
  addCardCommand,
  addBulkCardsCommand,
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(env.discordToken);

async function main() {
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), {
    body: commands,
  });

  success("Slash commands registered");
}

main().catch(errorLog);
