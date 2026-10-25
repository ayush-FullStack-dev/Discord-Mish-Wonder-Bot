import axios from "axios";
import { env } from "../config/env.js";
import { errorLog } from "../../logs/printLogs.js";

interface CreateOrderInput {
  cartCode: string;
  discordUserId: string;
  username: string;
}

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

    return {
      message: "Your checkout is being prepared.",
      data,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError = error.response?.data;
      const code: string | undefined = apiError?.code;

      if (code === "BAD_CART" || code === "CART_REQUIRED") {
        return {
          code,
          message:
            "Invalid or expired cart code. Please grab your cart again and enter the new code.",
        };
      }

      if (code === "NO_CARD" || code === "CARD_REQUIRED") {
        return {
          code,
          message: "No payment card is available. Please contact support.",
        };
      }

      if (status === 401 || code === "UNAUTHORIZED") {
        return {
          code,
          message: "API authentication failed. Please contact support.",
        };
      }

      if (status === 429 || code === "RATE_LIMITED") {
        return {
          code,
          message: "Too many requests. Please try again later.",
        };
      }

      return {
        code,
        message:
          apiError?.error ??
          "Failed to create checkout. Please try again later.",
      };
    }

    errorLog(`Unexpected error creating order: ${String(error)}`);

    return {
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred. Please try again later.",
    };
  }
}
