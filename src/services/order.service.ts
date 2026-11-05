import axios from "axios";
import { env } from "../config/env.js";
import { errorLog } from "../../logs/printLogs.js";
import { getBestChain } from "../utils/chain.js";

export const CARD_REJECTION_CODES = [
  "BAD_CARD",
  "CARD_DECLINED",
  "CARD_REJECTED",
  "FORTER_DECLINE",
  "CREDIT_NOT_SUPPORTED",
  "PAYMENT_FAILED",
] as const;

interface CreateOrderInput {
  cartCode: string;
}

export interface RepriceCheckoutData {
  ok: boolean;
  id: string;
  status: string;
  restaurant: string;
  items: CheckoutItem[];
  price: CheckoutPrice & {
    discount?: number;
  };
  fulfillment: string;
  dropoff: string;
  address: string | null;
  chain: string;
  referral_code: string | null;
  referral_applied: boolean;
  account: string | null;
  card: string | null;
  expires_in: number;
  order_id: string | null;
  tracking: string | null;
  tracking_url: string | null;
  notes: string | null;
  unit: string | null;
  account_credit: number;
  referral_pays: number;
  referral_problem: string | null;
  tip_warning: string | null;
  name: string | null;
  name_warning: string | null;
  step: string | null;
  order_ref: string;
  expires_at: string;
  result: unknown;
  error: unknown;
  forter_pending: boolean;
  card_pending: boolean;
  forter_declines: number;
  forter: Record<string, unknown>;
}

export type RepriceOrderResult =
  | {
      ok: true;
      data: RepriceCheckoutData;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

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

export type EditOrderPayload = Record<string, unknown>;

export type OrderCard = {
  cardNumber: string;
  cvv: string;
  expiryDate: string;
  zipcode: string;
};

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

export type EditOrderResult =
  | {
      ok: true;
      data: any;
      code?: never;
      message?: never;
    }
  | {
      ok: false;
      code: string;
      message: string;
      data?: never;
    };

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;

    if (typeof data?.message === "string") return data.message;
    if (typeof data?.error === "string") return data.error;

    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

export async function createOrder(
  input: CreateOrderInput,
  card: OrderCard,
): Promise<CreateOrderResult> {
  try {
    const chainId = await getBestChain("most_unused_credit");
    const response = await axios.post<CheckoutData>(
      `${env.yonderApiBaseUrl}/checkouts`,
      {
        cart_code: input.cartCode,
        card: `${card.cardNumber},${card.expiryDate},${card.cvv},${card.zipcode}`,
        chain: chainId,
      },
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data: CheckoutData = response.data;

    if (!data) {
      throw new Error("INVALID_API_RESPONSE");
    }

    return {
      code: null,
      message: "Your checkout is being prepared.",
      data,
    };
  } catch (error: unknown) {
    const code = axios.isAxiosError(error)
      ? (error.response?.data?.code ?? "UNKNOWN_ERROR")
      : error instanceof Error
        ? error.message
        : "UNKNOWN_ERROR";
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;

    const responseError = axios.isAxiosError(error)
      ? error.response?.data?.error
      : undefined;

    const isCardRejected =
      CARD_REJECTION_CODES.includes(
        code as (typeof CARD_REJECTION_CODES)[number],
      ) ||
      (code === "CHECKOUT_FAILED" &&
        typeof responseError === "string" &&
        (responseError.includes(
          "Issuer or Cardholder has put a restriction on the card",
        ) ||
          responseError.includes("SAVING_CREDIT_CARD_FAILED") ||
          responseError.includes("Braintree exception: Closed Card")));

    if (isCardRejected) {
      return {
        code: "PAYMENT_ERROR",
        message: "Your payment method was declined.",
      };
    }

    errorLog(`Failed to create checkout: code ${code}`);

    if (code === "BAD_CART" || code === "CART_REQUIRED") {
      return {
        code: "BAD_CART",
        message:
          "Invalid or expired cart code. Please grab your cart again and enter the new code.",
      };
    }

    if (code === "NO_CARD" || code === "CARD_REQUIRED") {
      return {
        code: "NO_CARD",
        message: "No payment card is available. Please contact support.",
      };
    }

    if (status === 401 || status === 403 || code === "UNAUTHORIZED") {
      return {
        code: "UNAUTHORIZED",
        message: "API authentication failed. Please contact support.",
      };
    }

    if (status === 429 || code === "RATE_LIMITED") {
      return {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      };
    }

    const errorMessage = axios.isAxiosError(error)
      ? (error.response?.data?.message ??
        error.response?.data?.error ??
        error.message)
      : error instanceof Error
        ? error.message
        : String(error);

    return {
      code,
      message: getErrorMessage(error),
    };
  }
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

  try {
    const response = await axios.patch(
      `${env.yonderApiBaseUrl}/checkouts/${encodeURIComponent(id.trim())}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = response.data;

    if (!data) {
      throw new Error("INVALID_API_RESPONSE");
    }

    if (data.ok === false) {
      throw new Error(
        typeof data.code === "string" ? data.code : "UPDATE_FAILED",
      );
    }

    return {
      ok: true,
      data,
    };
  } catch (error: unknown) {
    const code = axios.isAxiosError(error)
      ? (error.response?.data?.code ?? "UNKNOWN_ERROR")
      : error instanceof Error
        ? error.message
        : "UNKNOWN_ERROR";

    errorLog(`Failed to edit checkout: code ${code}`);

    if (
      CARD_REJECTION_CODES.includes(
        code as (typeof CARD_REJECTION_CODES)[number],
      )
    ) {
      return {
        ok: false,
        code: "PAYMENT_ERROR",
        message: "Your payment method was declined.",
      };
    }

    if (code === "BAD_CART" || code === "CART_REQUIRED") {
      return {
        ok: false,
        code: "BAD_CART",
        message: "Invalid or expired cart code.",
      };
    }

    if (code === "NO_CARD" || code === "CARD_REQUIRED") {
      return {
        ok: false,
        code: "NO_CARD",
        message: "No payment card is available. Please contact support.",
      };
    }

    if (
      (axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)) ||
      code === "UNAUTHORIZED"
    ) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "API authentication failed. Please contact support.",
      };
    }

    if (
      (axios.isAxiosError(error) && error.response?.status === 429) ||
      code === "RATE_LIMITED"
    ) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      };
    }

    return {
      ok: false,
      code: code === "INVALID_API_RESPONSE" ? code : "UPDATE_FAILED",
      message: getErrorMessage(error),
    };
  }
}

export type ConfirmOrderResult =
  | {
      ok: true;
      data: any;
    }
  | {
      ok: false;
      message: string;
      status?: number;
    };

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
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiError: unknown = error.response?.data;

      const errorData =
        typeof apiError === "object" && apiError !== null
          ? (apiError as Record<string, unknown>)
          : {};

      const code =
        typeof errorData.code === "string" ? errorData.code : "UNKNOWN_ERROR";

      const apiMessage =
        typeof errorData.message === "string"
          ? errorData.message
          : typeof errorData.error === "string"
            ? errorData.error
            : undefined;

      if (
        CARD_REJECTION_CODES.includes(
          code as (typeof CARD_REJECTION_CODES)[number],
        ) ||
        (code === "ORDER_FAILED" &&
          typeof errorData.error === "string" &&
          errorData.error.includes("PAYMENT_FAILED"))
      ) {
        return {
          ok: false as const,
          code: "PAYMENT_ERROR",
          message: "Your payment could not be processed.",
        };
      }

      return {
        ok: false as const,
        message:
          apiMessage ??
          (status === 404
            ? "Checkout not found."
            : status === 401 || status === 403
              ? "Unable to authorize the confirmation request."
              : status === 429
                ? "Too many requests. Please try again shortly."
                : "Failed to confirm your checkout. Please try again later."),
        status,
      };
    }

    errorLog(`Unexpected error confirming checkout ${id}:`, error);

    return {
      ok: false as const,
      message: getErrorMessage(error),
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
      message: getErrorMessage(error),
    };
  }
}

export async function trackOrder(id: string) {
  if (!id?.trim()) {
    throw new Error("A valid tracking ID is required.");
  }

  try {
    const response = await axios.get(
      `${env.yonderApiBaseUrl}/track/${encodeURIComponent(id.trim())}`,
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  } catch (error: unknown) {
    errorLog(`Failed to track order ${id}: ${getErrorMessage(error)}`);
    throw error;
  }
}

export async function repriceOrder(id: string): Promise<RepriceOrderResult> {
  if (!id?.trim()) {
    return {
      ok: false,
      code: "INVALID_CHECKOUT_ID",
      message: "A valid checkout ID is required.",
    };
  }

  try {
    const response = await axios.post<RepriceCheckoutData>(
      `${env.yonderApiBaseUrl}/checkouts/${encodeURIComponent(id.trim())}/reprice`,
      {},
      {
        headers: {
          Authorization: `Bearer ${env.yonderApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    return {
      ok: true,
      data: response.data,
    };
  } catch (error: unknown) {
    errorLog(`Failed to reprice checkout ${id}: ${getErrorMessage(error)}`);

    return {
      ok: false,
      code: axios.isAxiosError(error)
        ? (error.response?.data?.code ?? "UNKNOWN_ERROR")
        : "UNKNOWN_ERROR",
      message: getErrorMessage(error),
    };
  }
}
