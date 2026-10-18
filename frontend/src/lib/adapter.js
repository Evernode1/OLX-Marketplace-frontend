// Contract access layer for the deployed Marketplace contract. Components talk only to this object
// (through client.ts). Argument order follows contracts/Marketplace.py exactly.
//
// A transaction that reaches ACCEPTED is not the same as a call that succeeded. A contract rejection
// (gl.vm.UserError) still finalizes, with txExecutionResultName FINISHED_WITH_ERROR, and
// waitForTransactionReceipt resolves normally. write() checks that field and throws the contract's own
// message, so a rejected order or listing never shows as success.

import * as L from "./rules.js";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";

export function createGenLayerAdapter(client, contractAddress) {
  if (!client || typeof client.readContract !== "function" || typeof client.writeContract !== "function") {
    throw new Error("A GenLayer client with readContract and writeContract is required.");
  }

  const read = (functionName, args = []) => client.readContract({ address: contractAddress, functionName, args });

  async function write(functionName, args = [], value = 0n) {
    const hash = await client.writeContract({ address: contractAddress, functionName, args, value: BigInt(value) });
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      retries: 160,
      interval: 3000,
      fullTransaction: true,
    });
    const resultName = receipt?.txExecutionResultName;
    if (resultName === ExecutionResult.FINISHED_WITH_ERROR) {
      const detail = receipt?.stderr || receipt?.result?.stderr || receipt?.data?.stderr;
      throw new Error(detail ? `[EXPECTED] ${detail}` : "[EXPECTED] The contract rejected this transaction.");
    }
    if (resultName === ExecutionResult.NOT_VOTED) {
      throw new Error("[TRANSIENT] The network has not finished voting on this transaction yet. Check again shortly.");
    }
    return { hash, receipt };
  }

  return {
    contractAddress,
    signerAddress: () => L.normalizeAddress(client.account?.address ?? ""),

    // ---- reads
    getConfig: () => read("get_config"),
    listCategories: () => read("list_categories"),
    searchListings: (category, city, minPrice, maxPrice, offset, limit) =>
      read("search_listings", [category, city, BigInt(minPrice), BigInt(maxPrice), BigInt(offset), BigInt(limit)]),
    getListing: (id) => read("get_listing", [BigInt(id)]),
    sellerListings: (seller, offset, limit) => read("seller_listings", [seller, BigInt(offset), BigInt(limit)]),
    getOffer: (id) => read("get_offer", [BigInt(id)]),
    getOrder: (id) => read("get_order", [BigInt(id)]),
    buyerOrders: (buyer, offset, limit) => read("buyer_orders", [buyer, BigInt(offset), BigInt(limit)]),
    sellerOrders: (seller, offset, limit) => read("seller_orders", [seller, BigInt(offset), BigInt(limit)]),
    getReputation: (who) => read("get_reputation", [who]),
    getReview: (orderId, role) => read("get_review", [BigInt(orderId), role]),
    getWatchCount: (id) => read("get_watch_count", [BigInt(id)]),
    isWatching: (id, who) => read("is_watching", [BigInt(id), who]),
    getReportCount: (id) => read("get_report_count", [BigInt(id)]),
    isModerator: (who) => read("is_moderator", [who]),
    getProfile: (who) => read("get_profile", [who]),

    // ---- writes (signed by the client account)
    createListing: (f) => write("create_listing", [
      f.title, f.description, f.category, BigInt(f.price), f.city, f.imageUri, f.condition,
    ]),
    updateListing: (id, f) => write("update_listing", [
      BigInt(id), f.title, f.description, BigInt(f.price), f.city, f.imageUri, f.condition,
    ]),
    setListingPaused: (id, paused) => write("set_listing_paused", [BigInt(id), paused]),
    removeListing: (id, reason) => write("remove_listing", [BigInt(id), reason]),
    restoreListing: (id) => write("restore_listing", [BigInt(id)]),
    reportListing: (id, reason) => write("report_listing", [BigInt(id), reason]),
    watchListing: (id, enabled) => write("watch_listing", [BigInt(id), enabled]),
    makeOffer: (listingId, amount) => write("make_offer", [BigInt(listingId), BigInt(amount)]),
    withdrawOffer: (id) => write("withdraw_offer", [BigInt(id)]),
    rejectOffer: (id) => write("reject_offer", [BigInt(id)]),
    acceptOffer: (id) => write("accept_offer", [BigInt(id)]),
    payOffer: (id, valueWei) => write("pay_offer", [BigInt(id)], valueWei),
    releaseReservation: (id) => write("release_reservation", [BigInt(id)]),
    buyNow: (id, valueWei) => write("buy_now", [BigInt(id)], valueWei),
    markDelivered: (id) => write("mark_delivered", [BigInt(id)]),
    confirmReceipt: (id) => write("confirm_receipt", [BigInt(id)]),
    autoRelease: (id) => write("auto_release", [BigInt(id)]),
    cancelOrder: (id) => write("cancel_order", [BigInt(id)]),
    openDispute: (id, claim) => write("open_dispute", [BigInt(id), claim]),
    respondDispute: (id, response) => write("respond_dispute", [BigInt(id), response]),
    resolveDispute: (id) => write("resolve_dispute", [BigInt(id)]),
    resolveDisputeManually: (id, refund) => write("resolve_dispute_manually", [BigInt(id), refund]),
    rateCounterparty: (id, stars, comment) => write("rate_counterparty", [BigInt(id), BigInt(stars), comment]),
    addCategory: (slug, name) => write("add_category", [slug, name]),
    setCategoryActive: (slug, active) => write("set_category_active", [slug, active]),
    setFeeBps: (bps) => write("set_fee_bps", [BigInt(bps)]),
    withdrawFees: () => write("withdraw_fees"),
    setModerator: (who, enabled) => write("set_moderator", [who, enabled]),
    setGlobalPause: (paused) => write("set_global_pause", [paused]),
    proposeOwner: (who) => write("propose_owner", [who]),
    acceptOwnership: () => write("accept_ownership"),
    setProfileName: (name) => write("set_profile_name", [name]),
  };
}
