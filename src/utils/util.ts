export function formatExpiryDate(expiresIn: number | string | Date): Date {
  if (expiresIn instanceof Date) {
    return expiresIn;
  }

  if (typeof expiresIn === "string") {
    return new Date(expiresIn);
  }

  return new Date(Date.now() + expiresIn * 1000);
}

export function getCardExpirationDate(expiryDate: string): Date {
  const match = expiryDate.match(/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/);

  if (!match || !match[2]) {
    throw new Error("Invalid expiry date. Expected MM/YY or MM/YYYY");
  }

  const month = Number(match[1]);
  const yearPart = match[2];

  const year =
    yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);

  return new Date(Date.UTC(year, month, 1));
}

export function centsToDollars(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

export function dollarsToCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

export function formatCountdown(expiresAt: Date | string): string {
  const remaining = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function getExpireIn(expiresAt: Date | string | number): number {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
}

export function calculateDiscountedOrderPrice(
  price: {
    subtotal: number;
    service: number;
    delivery: number;
    referral?: number;
    tax?: number;
    tip?: number;
    credit?: number;
  },
  discountPercentage: number,
): { total: number; discount: number } {
  if (
    !Number.isFinite(discountPercentage) ||
    discountPercentage < 0 ||
    discountPercentage > 100
  ) {
    throw new Error("Invalid order discount percentage.");
  }

  const baseAmounts = [price.subtotal, price.service, price.delivery];
  if (!baseAmounts.every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new Error(
      "Invalid order price: subtotal, service, and delivery must be finite non-negative amounts.",
    );
  }

  const componentCents = baseAmounts.map((amount) => Math.round(amount * 100));
  if (!componentCents.every(Number.isSafeInteger)) {
    throw new Error("Order price exceeds the supported currency range.");
  }

  const baseAmountCents = componentCents.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  if (!Number.isSafeInteger(baseAmountCents)) {
    throw new Error("Order price exceeds the supported currency range.");
  }

  const discountCents = Math.round(
    (baseAmountCents * discountPercentage) / 100,
  );
  if (!Number.isSafeInteger(discountCents)) {
    throw new Error(
      "Calculated discount exceeds the supported currency range.",
    );
  }

  const totalCents = baseAmountCents - discountCents;

  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error(
      "Calculated discounted order total must be a non-negative safe amount.",
    );
  }

  return {
    total: totalCents / 100,
    discount: discountCents / 100,
  };
}

export const secondsToMilliseconds = (seconds: number): number =>
  seconds * 1000;
