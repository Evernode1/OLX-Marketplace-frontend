import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { Button, Card, HelperText, Input, Label, Notice, PageHeader, SectionTitle, Textarea } from "../components/ui";
import { useRunner } from "../hooks/useRunner";
import { usePolled } from "../hooks/usePolled";
import {
  autoRelease, cancelOrder, confirmReceipt, getBuyerOrders, getReview, getSellerOrders, markDelivered, openDispute,
  rateCounterparty, resolveDispute, respondDispute,
} from "../lib/client";
import { formatIsoTimestamp, fromWei, NATIVE_SYMBOL, shortAddress } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { MAX_EVIDENCE, MAX_REVIEW, ORDER_STATUS, validateClaim, validateReview } from "../lib/rules.js";
import type { Order } from "../lib/types";

const passed = (iso: string) => iso !== "" && Date.parse(iso) <= Date.now();

export function Orders() {
  const wallet = useWallet();
  const me = wallet.address;
  const [tab, setTab] = useState<"buying" | "selling">("buying");
  const page = usePolled(
    async () => {
      if (!me) return { items: [] as Order[], next_offset: 0, total: 0 };
      return tab === "buying" ? getBuyerOrders(me, 0, 50) : getSellerOrders(me, 0, 50);
    },
    [me, tab],
    20_000,
    isContractConfigured && !!me,
  );
  const { busy, run } = useRunner(() => page.refresh());
  const [claims, setClaims] = useState<Record<number, string>>({});
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [stars, setStars] = useState<Record<number, number>>({});
  const [reviewText, setReviewText] = useState<Record<number, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const actionFor = (o: Order) => {
    const isBuyer = tab === "buying";
    const out: ReactNode[] = [];
    if (o.status === "paid" && !isBuyer) {
      out.push(<Button key="d" loading={busy === `d-${o.id}`} onClick={() => void run(`d-${o.id}`, (s) => markDelivered(s, o.id), "Marked as delivered", "The buyer now confirms receipt.")}>Mark delivered</Button>);
    }
    if (o.status === "paid") {
      out.push(<Button key="c" variant="secondary" loading={busy === `c-${o.id}`} onClick={() => void run(`c-${o.id}`, (s) => cancelOrder(s, o.id), "Order cancelled", "The buyer is refunded.")}>Cancel and refund</Button>);
    }
    if (o.status === "delivered" && isBuyer) {
      out.push(<Button key="cf" loading={busy === `cf-${o.id}`} onClick={() => void run(`cf-${o.id}`, (s) => confirmReceipt(s, o.id), "Receipt confirmed", "The seller has been paid.")}>Confirm receipt</Button>);
    }
    if (o.status === "delivered" && passed(o.deadline)) {
      out.push(<Button key="ar" variant="secondary" loading={busy === `ar-${o.id}`} onClick={() => void run(`ar-${o.id}`, (s) => autoRelease(s, o.id), "Payment released to seller")}>Release to seller</Button>);
    }
    if (o.status === "disputed" && (o.response !== "" || passed(o.deadline))) {
      out.push(<Button key="rd" variant="secondary" loading={busy === `rd-${o.id}`} onClick={() => void run(`rd-${o.id}`, (s) => resolveDispute(s, o.id), "Dispute resolved", "The outcome is shown on the order.")}>Resolve dispute</Button>);
    }
    return out;
  };

  const rate = async (o: Order) => {
    const s = stars[o.id] ?? 0;
    const err = validateReview(s, reviewText[o.id] ?? "");
    if (err) return setLocalError(err);
    setLocalError(null);
    await run(`rate-${o.id}`, (sig) => rateCounterparty(sig, o.id, s, reviewText[o.id] ?? ""), "Rating saved");
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Orders">Escrow status for purchases and sales. Payment is released when the buyer confirms, or after the confirmation window.</PageHeader>
      {!me && <Notice tone="info" title="Connect a wallet">Connect a wallet to see your orders.</Notice>}

      {me && (
        <div className="flex gap-2">
          <Button variant={tab === "buying" ? "primary" : "secondary"} onClick={() => setTab("buying")}>Purchases</Button>
          <Button variant={tab === "selling" ? "primary" : "secondary"} onClick={() => setTab("selling")}>Sales</Button>
        </div>
      )}

      {localError && <HelperText tone="error">{localError}</HelperText>}
      {me && page.loading && !page.data && <p className="text-[13px] text-mist-500">Loading orders…</p>}
      {me && page.data && page.data.items.length === 0 && <p className="text-[13px] text-mist-500">No orders here yet.</p>}

      <div className="space-y-4">
        {(page.data?.items ?? []).map((o) => {
          const isBuyer = tab === "buying";
          const counterparty = isBuyer ? o.seller : o.buyer;
          return (
            <Card key={o.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[16px] text-mist-100">
                    Order #{o.id} · <Link className="text-beacon-300" to={`/listing/${o.listing_id}`}>listing #{o.listing_id}</Link>
                  </p>
                  <p className="text-[13px] text-mist-400">
                    {fromWei(BigInt(o.amount), 4)} {NATIVE_SYMBOL} (fee {fromWei(BigInt(o.fee), 4)}) · {isBuyer ? "Seller" : "Buyer"} {shortAddress(counterparty)}
                  </p>
                </div>
                <span className="rounded-full border border-deep-600 px-2.5 py-1 text-[12px] text-mist-300">
                  {ORDER_STATUS[o.status as keyof typeof ORDER_STATUS] ?? o.status}
                </span>
              </div>

              <p className="text-[12px] text-mist-500">
                Paid {formatIsoTimestamp(o.paid_at)}
                {o.deadline && o.status !== "completed" && o.status !== "refunded" && <> · next deadline {formatIsoTimestamp(o.deadline)}</>}
              </p>
              {o.claim && <p className="text-[13px] text-mist-300"><span className="text-mist-500">Buyer claim:</span> {o.claim}</p>}
              {o.response && <p className="text-[13px] text-mist-300"><span className="text-mist-500">Seller response:</span> {o.response}</p>}
              {o.outcome && <p className="text-[13px] text-mist-300"><span className="text-mist-500">Outcome:</span> {o.outcome}</p>}

              <div className="flex flex-wrap gap-2">{actionFor(o)}</div>

              {isBuyer && o.status === "delivered" && (
                <div className="space-y-2 border-t border-deep-700 pt-3">
                  <Label hint={`${(claims[o.id] ?? "").length}/${MAX_EVIDENCE}`}>Open a dispute</Label>
                  <Textarea maxLength={MAX_EVIDENCE} value={claims[o.id] ?? ""} onChange={(e) => setClaims({ ...claims, [o.id]: e.target.value })} placeholder="What did not match the listing?" />
                  <Button
                    variant="danger"
                    loading={busy === `dp-${o.id}`}
                    onClick={() => {
                      const err = validateClaim(claims[o.id]);
                      if (err) return setLocalError(err);
                      setLocalError(null);
                      void run(`dp-${o.id}`, (s) => openDispute(s, o.id, (claims[o.id] ?? "").trim()), "Dispute opened", "The seller has 3 days to respond.");
                    }}
                  >
                    Open dispute
                  </Button>
                </div>
              )}

              {!isBuyer && o.status === "disputed" && o.response === "" && !passed(o.deadline) && (
                <div className="space-y-2 border-t border-deep-700 pt-3">
                  <Label hint={`${(responses[o.id] ?? "").length}/${MAX_EVIDENCE}`}>Respond to the dispute</Label>
                  <Textarea maxLength={MAX_EVIDENCE} value={responses[o.id] ?? ""} onChange={(e) => setResponses({ ...responses, [o.id]: e.target.value })} />
                  <Button
                    loading={busy === `rs-${o.id}`}
                    onClick={() => {
                      const err = validateClaim(responses[o.id]);
                      if (err) return setLocalError(err);
                      setLocalError(null);
                      void run(`rs-${o.id}`, (s) => respondDispute(s, o.id, (responses[o.id] ?? "").trim()), "Response sent");
                    }}
                  >
                    Send response
                  </Button>
                </div>
              )}

              {o.status === "completed" && (
                <RatingBlock order={o} role={isBuyer ? "seller" : "buyer"} stars={stars} setStars={setStars} text={reviewText} setText={setReviewText} onRate={() => void rate(o)} busy={busy === `rate-${o.id}`} />
              )}
            </Card>
          );
        })}
      </div>
      {!isContractConfigured && <Notice tone="warn" title="No contract configured">Set VITE_CONTRACT_ADDRESS first.</Notice>}
    </div>
  );
}

function RatingBlock(props: {
  order: Order;
  role: "buyer" | "seller";
  stars: Record<number, number>;
  setStars: (v: Record<number, number>) => void;
  text: Record<number, string>;
  setText: (v: Record<number, string>) => void;
  onRate: () => void;
  busy: boolean;
}) {
  const { order, role, stars, setStars, text, setText, onRate, busy } = props;
  const review = usePolled(() => getReview(order.id, role), [order.id, role], 0);
  if (review.data?.exists) {
    return <p className="border-t border-deep-700 pt-3 text-[13px] text-mist-400">You rated the {role}{review.data.comment ? `: “${review.data.comment}”` : "."}</p>;
  }
  return (
    <div className="space-y-2 border-t border-deep-700 pt-3">
      <Label>Rate the {role}</Label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button key={n} variant={(stars[order.id] ?? 0) >= n ? "primary" : "secondary"} onClick={() => setStars({ ...stars, [order.id]: n })}>
            {n}★
          </Button>
        ))}
      </div>
      <Input maxLength={MAX_REVIEW} value={text[order.id] ?? ""} onChange={(e) => setText({ ...text, [order.id]: e.target.value })} placeholder="Optional comment" />
      <Button variant="secondary" loading={busy} onClick={onRate}>Submit rating</Button>
    </div>
  );
}
