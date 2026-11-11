import axios from "axios";
import { env } from "../config/env.js";
import { errorLog, success } from "../../logs/printLogs.js";

const api = axios.create({
  baseURL: env.yonderApiBaseUrl,
  headers: {
    Authorization: `Bearer ${env.yonderApiKey}`,
    "Content-Type": "application/json",
  },
});

async function handleApiError(error: unknown): Promise<never> {
  if (axios.isAxiosError(error)) {
    throw new Error(error.response?.data?.error ?? error.message);
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
    const response = await api.get(`/jobs/${encodeURIComponent(jobId)}`);
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

export async function createAccountsOnChain({
  chain,
  count,
}: {
  chain: string;
  count: number;
}) {
  try {
    const account = await accountConfigure({
      count,
      chain,
    });

    if (!account.ok) {
      throw new Error("Failed to create account. Please try again later.");
    }

    if (account.state === "queued") {
      let accountStatus = await getJobStatus(account.job);

      while (!accountStatus.done) {
        if (!accountStatus.ok) {
          throw new Error("Failed to fetch account status.");
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        accountStatus = await getJobStatus(account.job);

        console.log(accountStatus)
      }

      if (!accountStatus.ok) {
        throw new Error("Account creation job failed.");
      }
    }

    success(`Successfully created ${count} accounts on chain ${chain}.`);
    return {
      ok: true,
      chain,
      count,
    };
  } catch (error) {
    errorLog("Account creation failed:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function lockChain(chain: string) {
  try {
    const response = await api.post(
      `/chains/${encodeURIComponent(chain)}/lock`,
    );

    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function unlockChain(chain: string) {
  try {
    const response = await api.post(
      `/chains/${encodeURIComponent(chain)}/unlock`,
    );

    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}
