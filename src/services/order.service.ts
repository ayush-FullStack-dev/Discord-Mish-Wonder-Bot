import axios from "axios";
import { env } from "../config/env.js";
import { errorLog } from "../../logs/printLogs.js";

interface CreateOrderInput {
  cartCode: string;
}

export interface CheckoutItem {
  name: string;
  quantity: number;
  subtotal: string;
}

export interface CheckoutPrice {
  subtotal: number;
  referral: number;
  service: number;
  delivery: number;
  tax: number;
  tip: number;
  credit: number;
  total: number;
}

export interface CheckoutData {
  ok: boolean;
  id: string;
  status: string;
  restaurant: string;
  items: CheckoutItem[];
  price: CheckoutPrice;
  fulfillment: string;
  dropoff: string | null;
  address: string | null;
  chain: string;
  referral_code: string | null;
  referral_applied: boolean;
  account: string | null;
  card: string | null;
  expires_in: number;
  order_id: string | null;
  tracking: string | null;
}

export type CreateOrderResult =
  | {
      code: null;
      message: string;
      data: CheckoutData;
    }
  | {
      code: string;
      message: string;
    };

export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  try {
    const response = await axios.post<CheckoutData>(
      `${env.yonderApiBaseUrl}/checkouts`,
      {
        cart_code: input.cartCode,
        card: "6011410090973830,08/29,284,33172",
      },
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data: CheckoutData = response.data;

    return {
      code: null,
      message: "Your checkout is being prepared.",
      data,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError: unknown = error.response?.data;

      const errorData =
        typeof apiError === "object" && apiError !== null
          ? (apiError as Record<string, unknown>)
          : {};

      const apiCode =
        typeof errorData.code === "string" ? errorData.code : undefined;

      const apiMessage =
        typeof errorData.error === "string" ? errorData.error : undefined;

      if (apiCode === "BAD_CART" || apiCode === "CART_REQUIRED") {
        return {
          code: apiCode,
          message:
            "Invalid or expired cart code. Please grab your cart again and enter the new code.",
        };
      }

      if (apiCode === "NO_CARD" || apiCode === "CARD_REQUIRED") {
        return {
          code: apiCode,
          message: "No payment card is available. Please contact support.",
        };
      }

      if (status === 401 || status === 403 || apiCode === "UNAUTHORIZED") {
        return {
          code: "UNAUTHORIZED",
          message: "API authentication failed. Please contact support.",
        };
      }

      if (status === 429 || apiCode === "RATE_LIMITED") {
        return {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        };
      }

      return {
        code: apiCode ?? "UNKNOWN_ERROR",
        message:
          apiMessage ?? "Failed to create checkout. Please try again later.",
      };
    }

    errorLog(`Unexpected error creating order: ${String(error)}`);

    return {
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred. Please try again later.",
    };
  }
}

export async function cancelOrder(id: string) {
  try {
    const response = await axios.post(
      `${env.yonderApiBaseUrl}/checkouts/${encodeURIComponent(id)}/cancel`,
      {},
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        }
      },
    );

    return {
      ok: true as const,
      message: "Your checkout has been cancelled successfully.",
      data: response.data,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError: unknown = error.response?.data;

      const errorData =
        typeof apiError === "object" && apiError !== null
          ? (apiError as Record<string, unknown>)
          : {};

      const apiMessage =
        typeof errorData.message === "string"
          ? errorData.message
          : typeof errorData.error === "string"
            ? errorData.error
            : undefined;

      errorLog(`Failed to cancel checkout ${id}: HTTP ${status ?? "unknown"}`);

      return {
        ok: false as const,
        message:
          apiMessage ??
          (status === 404
            ? "Checkout not found."
            : status === 401 || status === 403
              ? "Unable to authorize the cancellation request."
              : status === 429
                ? "Too many requests. Please try again shortly."
                : "Failed to cancel your checkout. Please try again later."),
        status,
      };
    }

    errorLog(`Unexpected error cancelling checkout ${id}: ${String(error)}`);

    return {
      ok: false as const,
      message: "An unexpected error occurred while cancelling your checkout.",
    };
  }
}
export async function confirmOrder(id: string) {
  try {
    const response = await axios.post(
      `${env.yonderApiBaseUrl}/checkouts/${encodeURIComponent(id)}/confirm`,
      {},
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        }
      },
    );

    console.log(response.data)
    
    return {
      ok: true as const,
      data: response.data,
    };
  } catch (error: unknown) {
    console.log(error)
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError: unknown = error.response?.data;

      const errorData =
        typeof apiError === "object" && apiError !== null
          ? (apiError as Record<string, unknown>)
          : {};

      const apiMessage =
        typeof errorData.message === "string"
          ? errorData.message
          : typeof errorData.error === "string"
            ? errorData.error
            : undefined;

      errorLog(`Failed to cancel checkout ${id}: HTTP ${status ?? "unknown"}`);

      return {
        ok: false as const,
        message:
          apiMessage ??
          (status === 404
            ? "Checkout not found."
            : status === 401 || status === 403
              ? "Unable to authorize the cancellation request."
              : status === 429
                ? "Too many requests. Please try again shortly."
                : "Failed to cancel your checkout. Please try again later."),
        status,
      };
    }

    errorLog(`Unexpected error cancelling checkout ${id}: ${String(error)}`);

    return {
      ok: false as const,
      message: "An unexpected error occurred while cancelling your checkout.",
    };
  }
}
