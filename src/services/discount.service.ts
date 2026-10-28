import { DiscountSetting } from "../models/discount-setting.model.js";

const DISCOUNT_SETTING_ID = "order-discount";
const DEFAULT_DISCOUNT_PERCENTAGE = 55;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function validateDiscountPercentage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error("Stored discount percentage is invalid.");
  }

  return value;
}

export async function getDiscountPercentage(): Promise<number> {
  let setting;

  try {
    setting = await DiscountSetting.findOneAndUpdate(
      { _id: DISCOUNT_SETTING_ID },
      { $setOnInsert: { discountPercentage: DEFAULT_DISCOUNT_PERCENTAGE } },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
      },
    )
      .lean()
      .exec();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    setting = await DiscountSetting.findById(DISCOUNT_SETTING_ID)
      .lean()
      .exec();
    if (!setting) throw error;
  }

  if (!setting) {
    throw new Error("Discount setting could not be initialized.");
  }

  return validateDiscountPercentage(setting.discountPercentage);
}

export async function updateDiscountPercentage(
  percentage: number,
): Promise<number> {
  if (
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw new Error("Discount percentage must be between 0 and 100.");
  }

  let setting;

  try {
    setting = await DiscountSetting.findOneAndUpdate(
      { _id: DISCOUNT_SETTING_ID },
      { $set: { discountPercentage: percentage } },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
      },
    )
      .lean()
      .exec();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    setting = await DiscountSetting.findOneAndUpdate(
      { _id: DISCOUNT_SETTING_ID },
      { $set: { discountPercentage: percentage } },
      {
        returnDocument: "after",
        runValidators: true,
      },
    )
      .lean()
      .exec();
    if (!setting) throw error;
  }

  if (!setting) {
    throw new Error("Discount setting could not be saved.");
  }

  return validateDiscountPercentage(setting.discountPercentage);
}
