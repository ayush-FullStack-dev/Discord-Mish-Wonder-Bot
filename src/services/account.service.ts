import axios from "axios";
import { env } from "../config/env.js";

const api = axios.create({
  baseURL: env.yonderApiBaseUrl,
  headers: {
    Authorization: `Bearer ${env.yonderApiKey}`,
    "Content-Type": "application/json",
  },
});

async function handleApiError(error: unknown): Promise<never> {
  if (axios.isAxiosError(error)) {
    throw new Error(
      error.response?.data?.error ?? error.message,
    );
  }

  throw error;
}

export async function accountConfigure(
  payload: {
    count: number;
    chain: string;
  } = {
    count: 1,
    chain: "1",
  },
) {
  try {
    const response = await api.post("/accounts", payload);
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function getAccounts() {
  try {
    const response = await api.get("/accounts");
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function getChains() {
  try {
    const response = await api.get("/chains");
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function getChainQueue() {
  try {
    const response = await api.get("/chains/queue");
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function getJobStatus(jobId: string) {
  try {
    const response = await api.get(
      `/jobs/${encodeURIComponent(jobId)}`,
    );
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}
export async function getJobs() {
  try {
    const response = await api.get("/jobs");
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}
