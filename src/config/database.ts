import mongoose from "mongoose";
import { env } from "./env.js";
import { errorLog } from "../../logs/printLogs.js";

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.mongodbUri);
  } catch (error) {
    errorLog(`MongoDB connection failed: ${error}`);
    process.exit(1);
  }
}
