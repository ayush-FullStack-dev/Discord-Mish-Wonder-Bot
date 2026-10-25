import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.mongodbUri, {
    dbName: "mish-wonder",
  });
}

export function getBalanceDatabase() {
  return mongoose.connection.useDb("mishgpt");
}