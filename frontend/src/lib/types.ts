import type { Eip1193Provider } from "./injectedWallets";

export type WalletMode = "none" | "burner-locked" | "burner-unlocked" | "injected";

/** A usable signer: an address, plus the private key (built-in wallet) or the EIP-1193 provider (browser wallet). */
export interface Signer {
  address: `0x${string}`;
  privateKey?: `0x${string}`;
  provider?: Eip1193Provider;
}

export interface MarketConfig {
  owner: string;
  global_paused: boolean;
  fee_bps: number;
  accrued_fees: number;
  escrowed: number;
  listing_count: number;
  offer_count: number;
  order_count: number;
  category_count: number;
}

export interface Category {
  slug: string;
  name: string;
  active: boolean;
}

export interface Listing {
  id: number;
  seller: string;
  title: string;
  description: string;
  category: string;
  price: number;
  city: string;
  image_uri: string;
  condition: string;
  status: string; // active | paused | reserved | sold | removed | hidden
  reserved_for: string;
  created_at: string;
  updated_at: string;
  watchers: number;
  reports: number;
}

export interface Offer {
  id: number;
  listing_id: number;
  buyer: string;
  amount: number;
  status: string; // open | accepted | paid | rejected | withdrawn | expired
  created_at: string;
  accepted_at: string;
  order_id: number | null;
}

export interface Order {
  id: number;
  listing_id: number;
  offer_id: number | null;
  buyer: string;
  seller: string;
  amount: number;
  fee: number;
  status: string; // paid | delivered | disputed | completed | refunded
  paid_at: string;
  deadline: string;
  delivered_at: string;
  claim: string;
  response: string;
  outcome: string;
}

export interface Page<T> {
  items: T[];
  total?: number;
  next_offset?: number;
  done?: boolean;
}

export interface Reputation {
  ratings: number;
  average_x100: number;
  name: string;
}
