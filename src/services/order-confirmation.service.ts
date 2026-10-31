export type ProviderConfirmationOutcome =
  | "uncertain"
  | "declined"
  | "confirmed";

export type StaleConfirmationAction = "release" | "mark_unknown" | "ignore";

type ProviderRecord = Record<string, unknown>;

function isProviderRecord(value: unknown): value is ProviderRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getProviderRecords(data: unknown): ProviderRecord[] {
  if (!isProviderRecord(data)) return [];

  const records = [data];
  for (const key of ["error", "data", "response"] as const) {
    const nested = data[key];
    if (isProviderRecord(nested)) records.push(nested);
  }

  return records;
}

export function sanitizeProviderErrorMessage(message: string): string {
  return message
    .replace(/\b(?:\d[ -]?){3,19}\b/g, "[redacted]")
    .replace(
      /\b(authorization|api[-_ ]?key|token|cvv|cvc|security code)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 300);
}

export function getProviderConfirmationDetails(data: unknown): {
  code: string | null;
  message: string | null;
} {
  const records = getProviderRecords(data);
  let code: string | null = null;
  let message: string | null = null;

  for (const record of records) {
    if (!code && typeof record.code === "string") code = record.code;
    if (!code && typeof record.error_code === "string") {
      code = record.error_code;
    }
    if (!message && typeof record.message === "string") {
      message = record.message;
    }
    if (!message && typeof record.error === "string") {
      message = record.error;
      if (
        !code &&
        ["FORTER_DECLINE", "CHECKOUT_FAILED"].includes(record.error)
      ) {
        code = record.error;
        message = null;
      }
    }
  }

  return {
    code,
    message: message ? sanitizeProviderErrorMessage(message) : null,
  };
}

export function createPendingOrderClaimFilter(
  checkoutId: string,
  discordUserId: string,
  now: Date,
) {
  return {
    checkoutId,
    discordUserId,
    status: "pending" as const,
    confirming: { $ne: true },
    expiresAt: { $gt: now },
  };
}

export function getStaleConfirmationAction(
  state: string | null | undefined,
): StaleConfirmationAction {
  if (state === "claimed") return "release";
  if (
    state === "provider_requested" ||
    state === "cancel_requested" ||
    state == null
  ) {
    return "mark_unknown";
  }
  return "ignore";
}

export function classifyProviderConfirmation(
  ok: boolean,
  data: unknown,
): ProviderConfirmationOutcome {
  const details = getProviderConfirmationDetails(data);
  const cardDeclineMessage =
    details.code === "CHECKOUT_FAILED" &&
    details.message?.includes("SAVING_CREDIT_CARD_FAILED") &&
    (details.message.includes("Pick Up Card") ||
      details.message.includes(
        "Issuer or Cardholder has put a restriction on the card",
      ));

  if (details.code === "FORTER_DECLINE" || cardDeclineMessage) {
    return "declined";
  }

  if (!ok) return "uncertain";

  if (!isProviderRecord(data) || data.ok === false || data.success === false) {
    return "uncertain";
  }

  if (data.ok === true || data.success === true) return "confirmed";

  if (
    typeof data.order_id === "string" &&
    data.order_id.trim().length > 0
  ) {
    return "confirmed";
  }

  if (
    typeof data.status === "string" &&
    ["confirmed", "complete", "completed", "success", "accepted"].includes(
      data.status.toLowerCase(),
    )
  ) {
    return "confirmed";
  }

  return "uncertain";
}
