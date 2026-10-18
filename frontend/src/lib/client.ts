import { createAccount, createClient } from "genlayer-js";
import { activeChain, CONTRACT_ADDRESS } from "./networks";
import { createGenLayerAdapter } from "./adapter.js";
import { withActiveProvider } from "./injectedWallets";
import { ensureWalletOnActiveNetwork } from "./evm";
import type { Signer, MarketConfig, Category, Listing, Offer, Order, Page, Reputation } from "./types";

type Adapter = ReturnType<typeof createGenLayerAdapter>;

// Reads need no signer, so browsing works before a wallet is connected.
const readClient = createClient({ chain: activeChain });
const readAdapter: Adapter = createGenLayerAdapter(readClient, CONTRACT_ADDRESS);

/** genlayer-js can return Maps and bigints. The UI wants plain objects and safe numbers. */
function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => {
      obj[String(k)] = normalize(v);
    });
    return obj;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) obj[k] = normalize(v);
    return obj;
  }
  return value;
}

async function view<T>(call: () => Promise<unknown>): Promise<T> {
  return normalize(await call()) as T;
}

/** Runs one write for a specific signer. A browser wallet is moved to the app's network first. */
export async function withSigner<T>(signer: Signer, fn: (adapter: Adapter) => Promise<T>): Promise<T> {
  const isPrivateKey = !!signer.privateKey;
  if (!isPrivateKey && signer.provider) await ensureWalletOnActiveNetwork(signer.provider);
  const account: unknown = isPrivateKey ? createAccount(signer.privateKey as `0x${string}`) : signer.address;
  const client = createClient({ chain: activeChain, account } as Parameters<typeof createClient>[0]);
  const adapter = createGenLayerAdapter(client, CONTRACT_ADDRESS);
  return withActiveProvider(isPrivateKey ? null : (signer.provider ?? null), () => fn(adapter));
}

export async function readClientBalance(address: `0x${string}`): Promise<bigint> {
  const client = readClient as unknown as { getBalance: (args: { address: `0x${string}` }) => Promise<bigint> };
  return client.getBalance({ address });
}

// ---------------------------------------------------------------- views
export const getConfig = () => view<MarketConfig>(() => readAdapter.getConfig());
export const listCategories = async () =>
  (await view<{ items: Category[] }>(() => readAdapter.listCategories())).items;
export const searchListings = (category: string, city: string, minPrice: bigint, maxPrice: bigint, offset: number, limit: number) =>
  view<Page<Listing>>(() => readAdapter.searchListings(category, city, minPrice, maxPrice, offset, limit));
export const getListing = (id: number) => view<Listing>(() => readAdapter.getListing(id));
export const getSellerListings = (seller: string, offset: number, limit: number) =>
  view<Page<Listing>>(() => readAdapter.sellerListings(seller, offset, limit));
export const getOffer = (id: number) => view<Offer>(() => readAdapter.getOffer(id));
export const getOrder = (id: number) => view<Order>(() => readAdapter.getOrder(id));
export const getBuyerOrders = (buyer: string, offset: number, limit: number) =>
  view<Page<Order>>(() => readAdapter.buyerOrders(buyer, offset, limit));
export const getSellerOrders = (seller: string, offset: number, limit: number) =>
  view<Page<Order>>(() => readAdapter.sellerOrders(seller, offset, limit));
export const getReputation = (who: string) => view<Reputation>(() => readAdapter.getReputation(who));
export const getReview = (orderId: number, role: "buyer" | "seller") =>
  view<{ exists: boolean; comment: string }>(() => readAdapter.getReview(orderId, role));
export const getWatchCount = async (id: number) => (await view<{ count: number }>(() => readAdapter.getWatchCount(id))).count;
export const isWatching = (id: number, who: string) => view<boolean>(() => readAdapter.isWatching(id, who));
export const getReportCount = async (id: number) => (await view<{ count: number }>(() => readAdapter.getReportCount(id))).count;
export const isModerator = (who: string) => view<boolean>(() => readAdapter.isModerator(who));
export const getProfile = (who: string) => view<string>(() => readAdapter.getProfile(who));

/** Offers have no per-seller or per-buyer index on chain, so the app scans the most recent offers. */
export const OFFER_SCAN_WINDOW = 300;

async function sellerListingIds(seller: string): Promise<Set<number>> {
  const ids = new Set<number>();
  let offset = 0;
  for (;;) {
    const page = await getSellerListings(seller, offset, 50);
    for (const l of page.items) ids.add(Number(l.id));
    offset = page.next_offset ?? offset;
    if (offset >= (page.total ?? 0) || page.items.length === 0) break;
  }
  return ids;
}

/** Offers on this seller's listings, newest first. */
export async function getIncomingOffers(seller: string, offerCount: number): Promise<Offer[]> {
  const mine = await sellerListingIds(seller);
  const out: Offer[] = [];
  for (let id = offerCount - 1; id >= 0 && id >= offerCount - OFFER_SCAN_WINDOW; id--) {
    const o = await getOffer(id);
    if (mine.has(Number(o.listing_id))) out.push(o);
  }
  return out;
}

/** Offers this buyer made, newest first. */
export async function getMyOffers(buyer: string, offerCount: number): Promise<Offer[]> {
  const out: Offer[] = [];
  const b = buyer.toLowerCase();
  for (let id = offerCount - 1; id >= 0 && id >= offerCount - OFFER_SCAN_WINDOW; id--) {
    const o = await getOffer(id);
    if (String(o.buyer).toLowerCase() === b) out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- writes
export interface ListingForm {
  title: string;
  description: string;
  category: string;
  priceWei: bigint;
  city: string;
  imageUri: string;
  condition: string;
}

export const createListing = (s: Signer, f: ListingForm) =>
  withSigner(s, (a) => a.createListing({ ...f, price: f.priceWei, imageUri: f.imageUri }));
export const updateListing = (s: Signer, id: number, f: ListingForm) =>
  withSigner(s, (a) => a.updateListing(id, { ...f, price: f.priceWei, imageUri: f.imageUri }));
export const setListingPaused = (s: Signer, id: number, paused: boolean) =>
  withSigner(s, (a) => a.setListingPaused(id, paused));
export const removeListing = (s: Signer, id: number, reason: string) => withSigner(s, (a) => a.removeListing(id, reason));
export const restoreListing = (s: Signer, id: number) => withSigner(s, (a) => a.restoreListing(id));
export const reportListing = (s: Signer, id: number, reason: string) => withSigner(s, (a) => a.reportListing(id, reason));
export const watchListing = (s: Signer, id: number, enabled: boolean) => withSigner(s, (a) => a.watchListing(id, enabled));
export const makeOffer = (s: Signer, listingId: number, amount: bigint) => withSigner(s, (a) => a.makeOffer(listingId, amount));
export const withdrawOffer = (s: Signer, id: number) => withSigner(s, (a) => a.withdrawOffer(id));
export const rejectOffer = (s: Signer, id: number) => withSigner(s, (a) => a.rejectOffer(id));
export const acceptOffer = (s: Signer, id: number) => withSigner(s, (a) => a.acceptOffer(id));
export const payOffer = (s: Signer, id: number, amount: bigint) => withSigner(s, (a) => a.payOffer(id, amount));
export const releaseReservation = (s: Signer, id: number) => withSigner(s, (a) => a.releaseReservation(id));
export const buyNow = (s: Signer, listingId: number, price: bigint) => withSigner(s, (a) => a.buyNow(listingId, price));
export const markDelivered = (s: Signer, id: number) => withSigner(s, (a) => a.markDelivered(id));
export const confirmReceipt = (s: Signer, id: number) => withSigner(s, (a) => a.confirmReceipt(id));
export const autoRelease = (s: Signer, id: number) => withSigner(s, (a) => a.autoRelease(id));
export const cancelOrder = (s: Signer, id: number) => withSigner(s, (a) => a.cancelOrder(id));
export const openDispute = (s: Signer, id: number, claim: string) => withSigner(s, (a) => a.openDispute(id, claim));
export const respondDispute = (s: Signer, id: number, response: string) => withSigner(s, (a) => a.respondDispute(id, response));
export const resolveDispute = (s: Signer, id: number) => withSigner(s, (a) => a.resolveDispute(id));
export const resolveDisputeManually = (s: Signer, id: number, refund: boolean) =>
  withSigner(s, (a) => a.resolveDisputeManually(id, refund));
export const rateCounterparty = (s: Signer, id: number, stars: number, comment: string) =>
  withSigner(s, (a) => a.rateCounterparty(id, stars, comment));
export const addCategory = (s: Signer, slug: string, name: string) => withSigner(s, (a) => a.addCategory(slug, name));
export const setCategoryActive = (s: Signer, slug: string, active: boolean) => withSigner(s, (a) => a.setCategoryActive(slug, active));
export const setFeeBps = (s: Signer, bps: number) => withSigner(s, (a) => a.setFeeBps(bps));
export const withdrawFees = (s: Signer) => withSigner(s, (a) => a.withdrawFees());
export const setModerator = (s: Signer, who: string, enabled: boolean) => withSigner(s, (a) => a.setModerator(who, enabled));
export const setGlobalPause = (s: Signer, paused: boolean) => withSigner(s, (a) => a.setGlobalPause(paused));
export const proposeOwner = (s: Signer, who: string) => withSigner(s, (a) => a.proposeOwner(who));
export const acceptOwnership = (s: Signer) => withSigner(s, (a) => a.acceptOwnership());
export const setProfileName = (s: Signer, name: string) => withSigner(s, (a) => a.setProfileName(name));
