export function formatExpiryDate(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000);
}

function formatExpiry(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "Check expiry before confirming";
  }

  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainingSeconds = Math.max(0, seconds) % 60;

  return minutes > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${remainingSeconds}s`;
}

export function centsToDollars(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

export function dollarsToCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

export function formatCountdown(expiresAt: number): string {
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
