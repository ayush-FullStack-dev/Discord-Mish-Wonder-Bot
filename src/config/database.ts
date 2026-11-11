import mongoose from "mongoose";
import { env } from "./env.js";
import { Order } from "../models/order.model.js";

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.mongodbUri, {
    dbName: "mish-wonder",
  });
  const topology = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid") {
    throw new Error("Order wallet settlement requires a MongoDB replica set or sharded cluster.");
  }
  // Removing a schema declaration does not remove an existing MongoDB TTL index.
  // Fail startup rather than accept orders with unsafe expiration enabled.
  const indexes = await Order.collection.listIndexes().toArray().catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 26) return [];
    throw error;
  });
  for (const index of indexes) {
    if (index.key.expiresAt === 1 && index.expireAfterSeconds !== undefined && index.name) {
      await Order.collection.dropIndex(index.name).catch((error: unknown) => {
        // Another new-version instance may have completed the same migration.
        if (typeof error === "object" && error !== null && "code" in error && error.code === 27) return;
        throw error;
      });
    }
  }
}

export function getBalanceDatabase() {
  return mongoose.connection.useDb("mishgpt");
}