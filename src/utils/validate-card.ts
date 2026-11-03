import { UserFacingError } from "./error-handler.js";

export interface CardReference {
  cardnumber: string;
  cvv: string;
  expdate: string;
  fullname?: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
}

export function validateCardReference(cardReference: string): CardReference {
  const fields = cardReference.split("|");
  if (fields.length !== 7 && fields.length !== 8) {
    throw new UserFacingError("Invalid format. Expected 7 or 8 fields.");
  }

  const [cardnumber, expdate, cvv, fullname, address, city, state, zipcode] =
    fields.length === 8
      ? fields.map((field) => field.trim())
      : [
          ...fields.slice(0, 3).map((field) => field.trim()),
          undefined,
          ...fields.slice(3).map((field) => field.trim()),
        ];

  if (
    !cardnumber ||
    !cvv ||
    !expdate ||
    !address ||
    !city ||
    !state ||
    !zipcode
  ) {
    throw new UserFacingError("All fields are required.");
  }

  const validations = {
    cardnumber: /^\d{13,19}$/,
    cvv: /^\d{3,4}$/,
    expdate: /^(0[1-9]|1[0-2])\/(?:\d{2}|\d{4})$/,
    address: /^.{1,100}$/,
    city: /^[a-zA-Z\s.'-]{1,60}$/,
    state: /^[a-zA-Z\s.'-]{1,60}$/,
    zipcode: /^[a-zA-Z0-9\s-]{2,12}$/,
  };

  if (fullname && fullname.length > 100) {
    throw new UserFacingError("Invalid full name.");
  }

  if (!validations.cardnumber.test(cardnumber)) {
    throw new UserFacingError("Invalid card number format.");
  }

  if (!validations.expdate.test(expdate)) {
    throw new UserFacingError(
      "Invalid expiry date format. Use MM/YY or MM/YYYY.",
    );
  }

  if (!validations.cvv.test(cvv)) {
    throw new UserFacingError("Invalid CVV format.");
  }

  if (!validations.address.test(address)) {
    throw new UserFacingError("Invalid address.");
  }

  if (!validations.city.test(city)) {
    throw new UserFacingError("Invalid city.");
  }

  if (!validations.state.test(state)) {
    throw new UserFacingError("Invalid state.");
  }

  if (!validations.zipcode.test(zipcode)) {
    throw new UserFacingError("Invalid ZIP/postal code.");
  }

  return {
    cardnumber,
    expdate,
    cvv,
    ...(fullname && { fullname }),
    address,
    city,
    state,
    zipcode,
  };
}
