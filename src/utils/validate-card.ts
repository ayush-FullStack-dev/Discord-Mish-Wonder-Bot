export interface CardReference {
  cardnumber: string;
  cvv: string;
  expdate: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
}

export function validateCardReference(
  cardReference: string,
): CardReference {
  const cardReferenceRegex =
    /^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)$/;

  const match = cardReference.match(cardReferenceRegex);

  if (!match) {
    throw new Error(
      "Invalid format. Expected: cardnumber|cvv|expdate|address|city|state|zipcode",
    );
  }

  const [, cardnumber, cvv, expdate, address, city, state, zipcode] =
    match;

  if (
    !cardnumber ||
    !cvv ||
    !expdate ||
    !address ||
    !city ||
    !state ||
    !zipcode
  ) {
    throw new Error("All fields are required.");
  }

  const validations = {
    cardnumber: /^\d{12,19}$/,
    cvv: /^\d{3,4}$/,
    expdate: /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/,
    address: /^.{1,100}$/,
    city: /^[a-zA-Z\s.'-]{1,60}$/,
    state: /^[a-zA-Z\s.'-]{1,60}$/,
    zipcode: /^[a-zA-Z0-9\s-]{2,12}$/,
  };

  if (!validations.cardnumber.test(cardnumber)) {
    throw new Error("Invalid card number format.");
  }

  if (!validations.cvv.test(cvv)) {
    throw new Error("Invalid CVV format.");
  }

  if (!validations.expdate.test(expdate)) {
    throw new Error("Invalid expiry date format. Use MM/YY or MM/YYYY.");
  }

  if (!validations.address.test(address.trim())) {
    throw new Error("Invalid address.");
  }

  if (!validations.city.test(city.trim())) {
    throw new Error("Invalid city.");
  }

  if (!validations.state.test(state.trim())) {
    throw new Error("Invalid state.");
  }

  if (!validations.zipcode.test(zipcode.trim())) {
    throw new Error("Invalid ZIP/postal code.");
  }

  return {
    cardnumber,
    cvv,
    expdate,
    address: address.trim(),
    city: city.trim(),
    state: state.trim(),
    zipcode: zipcode.trim(),
  };
}