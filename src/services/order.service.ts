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
        },
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
        },
      },
    );

    return {
      ok: true as const,
      data: response.data,
    };
  } catch (error: unknown) {
    console.log(error);
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

export type EditOrderPayload = Record<string, unknown>;

export interface EditOrderResult {
  ok: boolean;
  code: string | null;
  message: string;
  data?: unknown;
  status?: number;
}

export async function editOrder(
  id: string,
  payload: EditOrderPayload,
): Promise<EditOrderResult> {
  if (!id?.trim()) {
    return {
      ok: false,
      code: "INVALID_CHECKOUT_ID",
      message: "A valid checkout ID is required.",
    };
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length === 0
  ) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "Provide at least one field to update.",
    };
  }

  try {
    const response = await axios.patch(
      `${env.yonderApiBaseUrl}/checkouts/${encodeURIComponent(id.trim())}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const data: unknown = response.data;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {
        ok: false,
        code: "INVALID_API_RESPONSE",
        message: "The API returned an invalid response.",
        status: response.status,
      };
    }

    const result = data as Record<string, unknown>;

    if (result.ok === false) {
      return {
        ok: false,
        code: typeof result.code === "string" ? result.code : "UPDATE_FAILED",
        message:
          typeof result.error === "string"
            ? result.error
            : "The checkout could not be updated.",
        data,
        status: response.status,
      };
    }

    return {
      ok: true,
      code: null,
      message: "Checkout updated successfully.",
      data,
      status: response.status,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData: unknown = error.response?.data;

      const errorData =
        typeof responseData === "object" &&
        responseData !== null &&
        !Array.isArray(responseData)
          ? (responseData as Record<string, unknown>)
          : {};

      const code =
        typeof errorData.code === "string" ? errorData.code : "UPDATE_FAILED";

      const message =
        typeof errorData.error === "string"
          ? errorData.error
          : typeof errorData.message === "string"
            ? errorData.message
            : "Failed to update checkout.";

      errorLog(
        `Failed to edit checkout: HTTP ${status ?? "unknown"}, code ${code}`,
      );

      return {
        ok: false,
        code,
        message,
        ...(status !== undefined ? { status } : {}),
      };
    }

    errorLog("Unexpected error while editing checkout.");

    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred while updating checkout.",
    };
  }
}
