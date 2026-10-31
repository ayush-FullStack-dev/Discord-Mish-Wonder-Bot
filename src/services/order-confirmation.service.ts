export type ProviderConfirmationOutcome =
  | "uncertain"
  | "declined"
  | "confirmed";

export type StaleConfirmationAction = "release" | "mark_unknown" | "ignore";

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
  if (!ok) return "uncertain";

  if (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "FORTER_DECLINE"
  ) {
    return "declined";
  }

  return "confirmed";
}
