export const ORDER_ERRORS: Record<
  string,
  { title: string; description: string; footer: string }
> = {
  BAD_CART: {
    title: "Invalid Cart",
    description: "Your cart is invalid or expired.",
    footer: "Grab a fresh cart and try again.",
  },

  CANNOT_PRICE: {
    title: "Unable to Price Cart",
    description: "This cart cannot be priced with its current configuration.",
    footer: "Check the error details and update your cart.",
  },

  CART_REQUIRED: {
    title: "Cart Required",
    description: "No cart code was provided.",
    footer: "Submit a valid cart code.",
  },

  NO_CARD: {
    title: "No Cards Available",
    description: "Your card pool is empty or all cards are currently in use.",
    footer: "Add an available card and try again.",
  },

  CARD_REQUIRED: {
    title: "Card Required",
    description: "No payment card was provided.",
    footer: "Provide a valid payment card.",
  },

  BAD_CARD: {
    title: "Invalid Card",
    description: "The provided card details could not be parsed.",
    footer: "Check your card details.",
  },

  CARD_DECLINED: {
    title: "Card Declined",
    description: "Your payment card was declined.",
    footer: "Try another available card.",
  },

  CARD_REJECTED: {
    title: "Card Rejected",
    description: "The replacement card was rejected.",
    footer: "Try another available card.",
  },

  FORTER_DECLINE: {
    title: "Payment Declined",
    description: "The payment was rejected by the fraud verification system.",
    footer: "Try another card or chain as applicable.",
  },

  CREDIT_NOT_SUPPORTED: {
    title: "Credit Not Supported",
    description: "This checkout cannot process credit-funded orders.",
    footer: "Use a referral chain instead.",
  },

  UNAUTHORIZED: {
    title: "Authentication Failed",
    description: "Your API key is invalid, missing, or revoked.",
    footer: "Check your API key.",
  },

  RATE_LIMITED: {
    title: "Rate Limited",
    description: "Too many requests. Please wait before trying again.",
    footer: "Retry after the specified delay.",
  },

  ADDRESS_REJECTED: {
    title: "Address Rejected",
    description: "Wonder does not accept the provided delivery address.",
    footer: "Try another address.",
  },

  ADDRESS_REQUIRED: {
    title: "Address Required",
    description: "A delivery address is required.",
    footer: "Provide a valid delivery address.",
  },

  BAD_ADDRESS: {
    title: "Invalid Address",
    description: "The provided address could not be resolved.",
    footer: "Check your delivery address.",
  },

  PICKUP_HAS_NO_ADDRESS: {
    title: "Pickup Checkout",
    description: "This checkout is configured for pickup.",
    footer: "Switch fulfillment to delivery first.",
  },

  BAD_DROPOFF: {
    title: "Invalid Dropoff",
    description: "The selected dropoff option is invalid.",
    footer: "Use a supported dropoff option.",
  },

  BAD_FULFILLMENT: {
    title: "Invalid Fulfillment",
    description: "The selected fulfillment type is invalid.",
    footer: "Use DELIVERY or PICKUP.",
  },

  BAD_TIP: {
    title: "Invalid Tip",
    description: "The provided tip amount is invalid.",
    footer: "Enter a valid tip amount.",
  },

  BAD_JSON: {
    title: "Invalid Request",
    description: "The request body contains invalid JSON.",
    footer: "Check your request format.",
  },

  BAD_COUNT: {
    title: "Invalid Count",
    description: "The requested count must be between 1 and 10.",
    footer: "Enter a valid count.",
  },

  BAD_SETTING: {
    title: "Invalid Setting",
    description: "One or more settings contain invalid values.",
    footer: "Check your settings and try again.",
  },

  UNKNOWN_SETTING: {
    title: "Unknown Setting",
    description: "The requested setting does not exist.",
    footer: "Check the setting name.",
  },

  BAD_TIER: {
    title: "Invalid Plan",
    description: "The requested subscription tier is invalid.",
    footer: "Use Starter, Pro, or Unlimited.",
  },

  BAD_CHAIN: {
    title: "Invalid Chain",
    description: "The provided chain identifier is invalid.",
    footer: "Check the chain ID or leave it empty.",
  },

  CHAIN_BUSY: {
    title: "Chain Busy",
    description: "This chain is currently settling.",
    footer: "Try again shortly.",
  },

  CHAIN_IN_USE: {
    title: "Chain In Use",
    description: "Another order is currently using this chain.",
    footer: "Wait and try again.",
  },

  CHAIN_STALLED: {
    title: "Chain Stalled",
    description: "The previous chain operation has not completed.",
    footer: "Try again after it completes.",
  },

  NO_CHAIN_FOR_ACCOUNT: {
    title: "No Chain Available",
    description: "The selected account is not assigned to a chain.",
    footer: "Configure an account chain first.",
  },

  ACCOUNT_NOT_ON_CHAIN: {
    title: "Account Not Found",
    description: "The account does not belong to the selected chain.",
    footer: "Check your chain configuration.",
  },

  NO_CHAINS: {
    title: "No Chains Available",
    description: "No chains have been configured.",
    footer: "Generate accounts first.",
  },

  NO_CHAIN_READY: {
    title: "No Chain Ready",
    description: "All available chains are currently busy.",
    footer: "Try again shortly.",
  },

  NO_CREDIT_READ: {
    title: "Credit Unavailable",
    description: "Account credit could not be retrieved.",
    footer: "Try again later.",
  },

  NO_REFERRAL: {
    title: "No Referral Available",
    description: "No unused referral account is available.",
    footer: "Generate more accounts.",
  },

  NO_SESSION: {
    title: "Session Unavailable",
    description: "The selected account has no saved session.",
    footer: "Check your account configuration.",
  },

  NO_SESSIONS: {
    title: "No Sessions Available",
    description: "No accounts with saved sessions were found.",
    footer: "Check your account pool.",
  },

  API_UNREACHABLE: {
    title: "API Unavailable",
    description: "The ordering API is currently unreachable.",
    footer: "Try again later.",
  },

  CHECKOUT_FAILED: {
    title: "Checkout Failed",
    description: "Checkout pricing failed.",
    footer: "Check the error details and try again.",
  },

  CHECKOUT_UNAVAILABLE: {
    title: "Checkout Unavailable",
    description: "The payment provider is currently unavailable.",
    footer: "Try again later.",
  },

  INTERNAL: {
    title: "Internal Error",
    description: "An internal API error occurred.",
    footer: "Please contact support.",
  },

  IN_PROGRESS: {
    title: "Checkout In Progress",
    description: "Another operation is already using this checkout.",
    footer: "Wait for the current operation to finish.",
  },

  NOTHING_TO_CHANGE: {
    title: "No Changes Detected",
    description: "Your request does not contain any changes.",
    footer: "Update at least one field.",
  },

  NOT_FOUND: {
    title: "Resource Not Found",
    description: "The requested resource could not be found.",
    footer: "Check the resource ID.",
  },

  NO_SUCH_CHECKOUT: {
    title: "Checkout Expired",
    description: "This checkout has expired or is unavailable.",
    footer: "Create a new checkout.",
  },

  NO_SUCH_CARD: {
    title: "Card Not Found",
    description: "The requested card does not exist in your pool.",
    footer: "Check your card details.",
  },

  NO_SUCH_CHAIN: {
    title: "Chain Not Found",
    description: "The requested chain does not exist.",
    footer: "Check your chain ID.",
  },

  NO_SUCH_JOB: {
    title: "Job Not Found",
    description: "The requested job could not be found.",
    footer: "Check the job ID.",
  },

  NO_SUCH_ORDER: {
    title: "Order Not Found",
    description: "The requested order could not be found.",
    footer: "Check the order ID.",
  },

  NO_SUCH_ROUTE: {
    title: "Invalid Endpoint",
    description: "The requested API endpoint does not exist.",
    footer: "Check the endpoint and HTTP method.",
  },

  QUOTA_EXHAUSTED: {
    title: "Daily Limit Reached",
    description: "You have used all available daily checkouts.",
    footer: "Your quota resets at midnight.",
  },

  TIMEOUT: {
    title: "Request Timeout",
    description: "The API took too long to respond.",
    footer: "Please try again.",
  },

  TOO_MANY_HELD: {
    title: "Checkout Limit Reached",
    description: "You already have five open checkouts.",
    footer: "Close an existing checkout first.",
  },

  TOO_MANY_JOBS: {
    title: "Job Limit Reached",
    description: "You already have three active generation jobs.",
    footer: "Wait for an existing job to finish.",
  },

  REF_REQUIRED: {
    title: "Reference Required",
    description: "A tracking reference ID is required.",
    footer: "Provide a valid reference ID.",
  },

  USE_CARD_PIN_ENDPOINT: {
    title: "Invalid Card Operation",
    description: "Card pinning must use the dedicated endpoint.",
    footer: "Use the card pin endpoint.",
  },

  NAME_UNSUPPORTED: {
    title: "Rename Unsupported",
    description: "This checkout does not support account renaming.",
    footer: "Check the checkout type.",
  },

  NAME_FAILED: {
    title: "Rename Failed",
    description: "Wonder could not update the account name.",
    footer: "Try again later.",
  },

  BAD_NAME: {
    title: "Invalid Name",
    description: "No valid account name was provided.",
    footer: "Provide a valid name.",
  },
};
