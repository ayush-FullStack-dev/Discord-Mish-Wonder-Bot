import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const encodedKey = env.encryptionKey;

  if (!encodedKey) {
    throw new Error("ENCRYPTION_KEY is missing.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== KEY_LENGTH || key.toString("base64") !== encodedKey) {
    throw new Error(
      "ENCRYPTION_KEY must be a valid Base64-encoded 32-byte key.",
    );
  }

  return key;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("Plaintext must be a string.");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decrypt(encryptedData: string): string {
  if (typeof encryptedData !== "string") {
    throw new TypeError("Encrypted data must be a string.");
  }

  const parts = encryptedData.split(":");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid or unsupported encrypted data format.");
  }

  const ivEncoded = parts[1]!;
  const tagEncoded = parts[2]!;
  const ciphertextEncoded = parts[3]!;

  const iv = Buffer.from(ivEncoded, "base64");
  const authTag = Buffer.from(tagEncoded, "base64");
  const ciphertext = Buffer.from(ciphertextEncoded, "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted data.");
  }

  const key = getEncryptionKey();

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
