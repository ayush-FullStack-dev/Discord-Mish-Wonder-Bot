import axios from "axios";
import { env } from "../config/env.js";

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
    const response = await axios.post(
      `${env.yonderApiBaseUrl}/accounts`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.error ?? error.message);
    }

    throw error;
  }
}

export async function getJobStatus(jobId: string) {
  try {
    const response = await axios.get(`${env.yonderApiBaseUrl}/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${env.yonderApiKey}`,
      },
    });

    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.error ?? error.message);
    }

    throw error;
  }
}

// await getJobStatus("job_8887073a1888");
// accountConfigure();
