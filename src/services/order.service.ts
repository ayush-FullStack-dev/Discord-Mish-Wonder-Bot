import axios from "axios";
import { env } from "../config/env.js";
import { errorLog } from "../../logs/printLogs.js";

interface CreateOrderInput {
  cartCode: string;
  discordUserId: string;
  username: string;
}

export async function getSettings() {
  try {
    const response = await axios.get(`${env.yonderApiBaseUrl}/settings`, {
      headers: {
        Authorization: `Bearer ${env.yonderApiKey}`,
      },
    });

    console.log(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Settings error:", error.response?.data);
    }

    throw error;
  }
}

export async function accountConfigure() {
  try {
    const response = await axios.post(
      `${env.yonderApiBaseUrl}/accounts`,
      {
        count: 1,
        chain: "1",
      },
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

export async function createOrder(input: CreateOrderInput) {
  try {
    const response = await axios.post(
      `${env.yonderApiBaseUrl}/checkouts`,
      {
        cart_code: input.cartCode,
      },
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = response.data;

    console.log(data);
    console.log("Creating checkout for:", input.discordUserId);

    return {
      message: "Your checkout is being prepared.",
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError = error.response?.data;

      const code: string | undefined = apiError?.code;

      console.error("Wonder API error:", {
        status,
        code,
        message: apiError?.error ?? error.message,
      });

      if (code === "BAD_CART" || code === "CART_REQUIRED") {
        return {
          message:
            "Invalid or expired cart code. Please grab your cart again and enter the new code.",
        };
      }

      if (code === "NO_CARD" || code === "CARD_REQUIRED") {
        return {
          message: "No payment card is available. Please contact support.",
        };
      }

      if (status === 401 || code === "UNAUTHORIZED") {
        return {
          message: "API authentication failed. Please contact support.",
        };
      }

      if (status === 429 || code === "RATE_LIMITED") {
        return {
          message: "Too many requests. Please try again later.",
        };
      }

      return {
        message:
          apiError?.error ??
          "Failed to create checkout. Please try again later.",
      };
    }

    errorLog(`Unexpected error creating order: ${String(error)}`);

    return {
      message: "An unexpected error occurred. Please try again later.",
    };
  }
}
