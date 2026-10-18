// Client-side checks that mirror contracts/Marketplace.py. They make errors show up early; the contract
// still decides, and every write is re-checked there.

export const MIN_TITLE = 3;
export const MAX_TITLE = 100;
export const MAX_DESC = 2000;
export const MAX_CITY = 60;
export const MAX_IMAGE = 200;
export const MAX_NAME = 40;
export const MAX_REVIEW = 200;
export const MAX_EVIDENCE = 1000;
export const MAX_REASON = 200;
export const MAX_PRICE_WEI = 10n ** 24n;
export const MAX_FEE_BPS = 500;
export const PAGE_SIZE = 12;
export const CONDITIONS = ["new", "used"];

const HEX = /^0x[0-9a-fA-F]{40}$/;

export function normalizeAddress(a) {
  return String(a ?? "").trim().toLowerCase();
}

export function isValidAddress(a) {
  return HEX.test(String(a ?? "").trim());
}

export function shortAddress(a) {
  if (!a) return "—";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function parseContractError(err) {
  let message = typeof err === "string" ? err : err?.shortMessage || err?.message || "Something went wrong.";
  const kind = /\[TRANSIENT\]/.test(message) ? "transient" : /\[LLM_ERROR\]/.test(message) ? "llm" : "contract";
  message = message.replace(/\[(EXPECTED|TRANSIENT|LLM_ERROR)\]\s*/g, "").trim();
  return { kind, message };
}

export function validateListing(f) {
  const errors = [];
  const title = String(f.title ?? "").trim();
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) errors.push(`Title must be ${MIN_TITLE}-${MAX_TITLE} characters.`);
  if (String(f.description ?? "").length > MAX_DESC) errors.push(`Description must be at most ${MAX_DESC} characters.`);
  if (String(f.city ?? "").length > MAX_CITY) errors.push(`City must be at most ${MAX_CITY} characters.`);
  const img = String(f.imageUri ?? "");
  if (img !== "" && (!img.startsWith("https://") || img.length > MAX_IMAGE || /\s/.test(img))) {
    errors.push("Image must be an https:// link (or left empty).");
  }
  if (!CONDITIONS.includes(f.condition)) errors.push("Choose new or used.");
  if (!f.category) errors.push("Choose a category.");
  if (f.priceWei === undefined || f.priceWei < 0n || f.priceWei > MAX_PRICE_WEI) errors.push("Enter a valid price.");
  return errors;
}

export function validateAmount(wei) {
  if (wei === undefined || wei <= 0n || wei > MAX_PRICE_WEI) return "Enter an amount greater than 0.";
  return null;
}

export function validateClaim(text) {
  const t = String(text ?? "").trim();
  if (t.length < 1 || t.length > MAX_EVIDENCE) return `Write 1-${MAX_EVIDENCE} characters.`;
  return null;
}

export function validateReview(stars, comment) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return "Choose 1 to 5 stars.";
  if (String(comment ?? "").length > MAX_REVIEW) return `Comment must be at most ${MAX_REVIEW} characters.`;
  return null;
}

export const LISTING_STATUS = {
  active: "Available",
  paused: "Paused",
  reserved: "Reserved",
  sold: "Sold",
  removed: "Removed",
  hidden: "Hidden after reports",
};

export const ORDER_STATUS = {
  paid: "Paid, awaiting delivery",
  delivered: "Delivered, awaiting confirmation",
  disputed: "In dispute",
  completed: "Completed",
  refunded: "Refunded",
};

export const OFFER_STATUS = {
  open: "Open",
  accepted: "Accepted, awaiting payment",
  paid: "Paid",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  expired: "Expired",
};
