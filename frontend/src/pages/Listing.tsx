import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { Button, Card, HelperText, Input, Label, Notice, PageHeader, SectionTitle, InfoRow } from "../components/ui";
import { useRunner } from "../hooks/useRunner";
import { usePolled } from "../hooks/usePolled";
import {
  buyNow, getListing, getProfile, getReportCount, getReputation, getWatchCount, isWatching, makeOffer,
  removeListing, reportListing, setListingPaused, watchListing,
} from "../lib/client";
import { formatIsoTimestamp, fromWei, NATIVE_SYMBOL, shortAddress, sameAddress, toWei } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { LISTING_STATUS, MAX_REASON, validateAmount } from "../lib/rules.js";

export function ListingPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const wallet = useWallet();
  const me = wallet.address;

  const data = usePolled(async () => {
    const listing = await getListing(id);
    const [watchers, reports, reputation, profile, watching] = await Promise.all([
      getWatchCount(id),
      getReportCount(id),
      getReputation(listing.seller),
      getProfile(listing.seller),
      me ? isWatching(id, me) : Promise.resolve(false),
    ]);
    return { listing, watchers, reports, reputation, profile, watching: Boolean(watching) };
  }, [id, me], 30_000, isContractConfigured && Number.isInteger(id));

  const { busy, run } = useRunner(() => data.refresh());
  const [offerAmount, setOfferAmount] = useState("");
  const [offerError, setOfferError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (data.loading && !data.data) return <p className="text-[13px] text-mist-500">Loading listing…</p>;
  if (data.error || !data.data) {
    return <Notice tone="error" title="Listing not found">{data.error ?? "No listing with this id."}</Notice>;
  }

  const { listing: l, watchers, reports, reputation, profile, watching } = data.data;
  const isSeller = sameAddress(me, l.seller);
  const active = l.status === "active";
  const avg = reputation.ratings > 0 ? (reputation.average_x100 / 100).toFixed(2) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link to="/" className="text-[13px] text-mist-400 hover:text-mist-200">← Back to browse</Link>
      <PageHeader title={l.title}>
        <span className="text-beacon-300">{fromWei(BigInt(l.price), 4)} {NATIVE_SYMBOL}</span>
        <span className="ml-3 text-mist-500">{LISTING_STATUS[l.status as keyof typeof LISTING_STATUS] ?? l.status}</span>
      </PageHeader>

      {l.image_uri && <img src={l.image_uri} alt="" className="max-h-80 w-full rounded-lg border border-deep-700 object-cover" />}

      <Card className="space-y-4 p-6">
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-mist-200">{l.description || "No description."}</p>
        <dl>
          <InfoRow label="Category">{l.category}</InfoRow>
          <InfoRow label="Condition">{l.condition}</InfoRow>
          <InfoRow label="City">{l.city || "Not given"}</InfoRow>
          <InfoRow label="Listed">{formatIsoTimestamp(l.created_at)}</InfoRow>
          <InfoRow label="Seller">
            <span className="font-mono text-[13px]">{shortAddress(l.seller)}</span>
            {profile && <span className="ml-2 text-mist-300">{profile}</span>}
            <span className="ml-2 text-[12px] text-mist-500">
              {avg ? `★ ${avg} (${reputation.ratings})` : "No ratings yet"}
            </span>
          </InfoRow>
          <InfoRow label="Watching">{watchers}</InfoRow>
        </dl>
      </Card>

      {l.status === "reserved" && (
        <Notice tone="info" title="Reserved">This item is reserved for another buyer while payment or delivery is in progress.</Notice>
      )}

      {!me && <Notice tone="info" title="Connect a wallet">Connect a wallet to buy, make offers, watch or report this listing.</Notice>}

      {me && !isSeller && (
        <section className="space-y-6">
          <SectionTitle>Buy</SectionTitle>
          <Card className="flex flex-wrap items-center gap-3 p-5">
            <Button
              loading={busy === "buy"}
              disabled={!active || !isContractConfigured}
              onClick={() => void run("buy", (s) => buyNow(s, id, BigInt(l.price)), "Order placed", "Funds are held in escrow until you confirm delivery.")}
            >
              Buy now for {fromWei(BigInt(l.price), 4)} {NATIVE_SYMBOL}
            </Button>
            {!active && <HelperText>This listing is not available for purchase.</HelperText>}
          </Card>

          <Card className="space-y-3 p-5">
            <Label hint={NATIVE_SYMBOL}>Make an offer</Label>
            <div className="flex flex-wrap gap-3">
              <Input className="max-w-xs" inputMode="decimal" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} placeholder="0.5" />
              <Button
                variant="secondary"
                loading={busy === "offer"}
                disabled={!active || !offerAmount}
                onClick={() => {
                  let wei: bigint;
                  try {
                    wei = toWei(offerAmount);
                  } catch {
                    setOfferError("Enter a plain number, for example 0.5");
                    return;
                  }
                  const err = validateAmount(wei);
                  if (err) {
                    setOfferError(err);
                    return;
                  }
                  setOfferError(null);
                  void run("offer", (s) => makeOffer(s, id, wei), "Offer sent", "The seller can accept it from the Sell page.");
                }}
              >
                Send offer
              </Button>
            </div>
            {offerError && <HelperText tone="error">{offerError}</HelperText>}
            <HelperText>Accepting an offer reserves the item for you. You then have 7 days to pay the offer amount from My offers.</HelperText>
          </Card>

          <Card className="flex flex-wrap items-center gap-3 p-5">
            <Button
              variant="secondary"
              loading={busy === "watch"}
              onClick={() => void run("watch", (s) => watchListing(s, id, !watching), watching ? "Removed from watchlist" : "Added to watchlist")}
            >
              {watching ? "Stop watching" : "Watch listing"}
            </Button>
          </Card>

          <Card className="space-y-3 p-5">
            <Label hint={`${reason.length}/${MAX_REASON}`}>Report this listing</Label>
            <Input maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with it?" />
            <Button
              variant="danger"
              loading={busy === "report"}
              disabled={!reason.trim()}
              onClick={() => void run("report", (s) => reportListing(s, id, reason.trim()), "Report sent", "Three reports hide a listing automatically.")}
            >
              Report
            </Button>
            <HelperText>{reports} report(s) so far.</HelperText>
          </Card>
        </section>
      )}

      {me && isSeller && (
        <section className="space-y-4">
          <SectionTitle>Manage</SectionTitle>
          <Card className="flex flex-wrap gap-3 p-5">
            <Link to={`/sell?edit=${id}`} className="inline-flex"><Button variant="secondary">Edit listing</Button></Link>
            {(l.status === "active" || l.status === "paused") && (
              <Button
                variant="secondary"
                loading={busy === "pause"}
                onClick={() => void run("pause", (s) => setListingPaused(s, id, l.status === "active"), l.status === "active" ? "Listing paused" : "Listing active again")}
              >
                {l.status === "active" ? "Pause" : "Unpause"}
              </Button>
            )}
            {l.status !== "reserved" && l.status !== "sold" && l.status !== "removed" && (
              <Button
                variant="danger"
                loading={busy === "remove"}
                onClick={() => {
                  if (window.confirm("Remove this listing? This cannot be undone.")) {
                    void run("remove", (s) => removeListing(s, id, reason.trim()), "Listing removed");
                  }
                }}
              >
                Remove
              </Button>
            )}
          </Card>
          <Input maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason for removal" />
          <p className="text-[12px] text-mist-500">Incoming offers are on the Sell page.</p>
        </section>
      )}

      {!isContractConfigured && <Notice tone="warn" title="No contract configured">Actions are disabled.</Notice>}
      {l.status === "removed" && <Notice tone="info">This listing was removed by its seller or a moderator.</Notice>}
    </div>
  );
}
