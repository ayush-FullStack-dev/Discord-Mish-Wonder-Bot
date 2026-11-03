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

export type ChainCredit = {
  account: string;
  credit: number;
  used: boolean;
};

export type Chain = {
  chain: string;
  accounts: number;
  unused: number;
  locked: boolean;
  next_account: string;
  ready: boolean;
  credit: ChainCredit[];
};
