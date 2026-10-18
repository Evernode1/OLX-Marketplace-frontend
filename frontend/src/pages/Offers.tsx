import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { Button, Card, Notice, PageHeader, SectionTitle } from "../components/ui";
import { useRunner } from "../hooks/useRunner";
import { usePolled } from "../hooks/usePolled";
import { getConfig, getMyOffers, payOffer, withdrawOffer } from "../lib/client";
import { formatIsoTimestamp, fromWei, NATIVE_SYMBOL } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { OFFER_STATUS } from "../lib/rules.js";
import type { Offer } from "../lib/types";

/** Offers you have made. Accepted offers are paid from here within 7 days. */
export function Offers() {
  const wallet = useWallet();
  const me = wallet.address;
  const cfg = usePolled(() => getConfig(), [], 30_000, isContractConfigured);
  const list = usePolled(
    async () => (me && cfg.data ? await getMyOffers(me, cfg.data.offer_count) : []),
    [me, cfg.data?.offer_count],
    30_000,
    isContractConfigured && !!me && !!cfg.data,
  );
  const { busy, run } = useRunner(async () => {
    await Promise.all([list.refresh(), cfg.refresh()]);
  });

  return (
    <div className="space-y-8">
      <PageHeader title="My offers">Offers you have made. When a seller accepts, pay the accepted amount here within 7 days.</PageHeader>
      {!me && <Notice tone="info" title="Connect a wallet">Connect a wallet to see your offers.</Notice>}
      {me && list.loading && !list.data && <p className="text-[13px] text-mist-500">Loading offers…</p>}
      {me && list.data && list.data.length === 0 && <p className="text-[13px] text-mist-500">You have not made any offers.</p>}

      <SectionTitle>Offers</SectionTitle>
      <div className="space-y-3">
        {(list.data ?? []).map((o: Offer) => (
          <Card key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-[13px] text-mist-300">
              <p>
                Offer #{o.id} on <Link className="text-beacon-300" to={`/listing/${o.listing_id}`}>listing #{o.listing_id}</Link> ·{" "}
                <span className="font-medium text-mist-100">{fromWei(BigInt(o.amount), 4)} {NATIVE_SYMBOL}</span>
              </p>
              <p className="text-mist-500">
                {OFFER_STATUS[o.status as keyof typeof OFFER_STATUS] ?? o.status} · {formatIsoTimestamp(o.created_at)}
              </p>
            </div>
            <div className="flex gap-2">
              {o.status === "accepted" && (
                <Button loading={busy === `pay-${o.id}`} onClick={() => void run(`pay-${o.id}`, (s) => payOffer(s, o.id, BigInt(o.amount)), "Payment sent", "Funds are held in escrow until you confirm delivery.")}>
                  Pay {fromWei(BigInt(o.amount), 4)} {NATIVE_SYMBOL}
                </Button>
              )}
              {o.status === "open" && (
                <Button variant="secondary" loading={busy === `wd-${o.id}`} onClick={() => void run(`wd-${o.id}`, (s) => withdrawOffer(s, o.id), "Offer withdrawn")}>
                  Withdraw
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
