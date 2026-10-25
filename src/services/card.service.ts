import axios from "axios";
import { env } from "../config/env.js";

const cardsUrl = `${env.yonderApiBaseUrl}/cards`;

const api = axios.create({
  headers: {
    Authorization: `Bearer ${env.yonderApiKey}`,
    "Content-Type": "application/json",
  },
});

function handleApiError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;

    const message =
      typeof data?.error === "string" ? data.error : error.message;

    throw new Error(`Yonder API error (${status ?? "unknown"}): ${message}`);
  }

  throw error instanceof Error
    ? error
    : new Error("An unexpected Yonder API error occurred.");
}

export async function addCard(payload: Record<string, unknown>) {
  try {
    const response = await api.post(cardsUrl, payload);
    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}

export async function getCards() {
  try {
    const response = await api.get(cardsUrl);
    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}

export async function pinCard(payload: Record<string, unknown>) {
  try {
    const response = await api.post(`${cardsUrl}/pin`, payload);
    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}


export async function burnCard(last4: string) {
  try {
    if (!/^\d{4}$/.test(last4)) {
      throw new Error("last4 must contain exactly 4 digits.");
    }

    const response = await api.delete(
      `${cardsUrl}/${encodeURIComponent(last4)}`,
    );

    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}

export async function getCardBurns() {
  try {
    const response = await api.get(`${cardsUrl}/burns`);
    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}

export async function deleteCards() {
  try {
    const response = await api.delete(cardsUrl);
    return response.data;
  } catch (error: unknown) {
    handleApiError(error);
  }
}

// deleteCards()