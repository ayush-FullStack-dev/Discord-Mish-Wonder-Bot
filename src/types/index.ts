export interface ICard {
  encryptedCardNumber: string;
  encryptedCardCvv: string;
  expiryDate: string;
  zipcode: string;
  state: string;
  city: string;
  address: string;
  isLocked?: boolean;
  status?: "active" | "inactive" | "expired" | "blocked";
  lastUsedBy?: string;
  isPin?: boolean;
}