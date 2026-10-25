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
