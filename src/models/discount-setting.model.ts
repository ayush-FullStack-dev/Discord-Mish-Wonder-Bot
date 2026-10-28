import { Schema, model } from "mongoose";

const discountSettingSchema = new Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    discountPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
  },
  {
    collection: "settings",
    versionKey: false,
  },
);

export const DiscountSetting = model(
  "DiscountSetting",
  discountSettingSchema,
  "settings",
);
