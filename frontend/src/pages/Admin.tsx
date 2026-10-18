import { useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { Button, Card, HelperText, Input, Label, Notice, PageHeader, SectionTitle } from "../components/ui";
import { useRunner } from "../hooks/useRunner";
import { usePolled } from "../hooks/usePolled";
import {
  acceptOwnership, addCategory, getConfig, isModerator, listCategories, proposeOwner, resolveDisputeManually,
  restoreListing, setCategoryActive, setFeeBps, setGlobalPause, setModerator, withdrawFees,
} from "../lib/client";
import { fromWei, NATIVE_SYMBOL, sameAddress, shortAddress } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { MAX_FEE_BPS, isValidAddress, normalizeAddress, parseContractError } from "../lib/rules.js";

/** Owner and moderator controls. The contract enforces who may call each function. */
export function Admin() {
  const wallet = useWallet();
  const me = wallet.address;
  const cfg = usePolled(() => getConfig(), [], 30_000, isContractConfigured);
  const cats = usePolled(() => listCategories(), [], 30_000, isContractConfigured);
  const mod = usePolled(() => (me ? isModerator(me) : Promise.resolve(false)), [me], 60_000, isContractConfigured && !!me);
  const { busy, run } = useRunner(async () => {
    await Promise.all([cfg.refresh(), cats.refresh(), mod.refresh()]);
  });

  const isOwner = !!cfg.data && !!me && sameAddress(cfg.data.owner, me);
  const isMod = Boolean(mod.data);
  const [catSlug, setCatSlug] = useState("");
  const [catName, setCatName] = useState("");
  const [fee, setFee] = useState("");
  const [modWallet, setModWallet] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const [disputeId, setDisputeId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (cfg.data) setFee(String(cfg.data.fee_bps / 100));
  }, [cfg.data?.fee_bps]);

  if (!me) return <Notice tone="info" title="Connect a wallet">Admin actions need the owner or a moderator wallet.</Notice>;
  if (!isContractConfigured) return <Notice tone="warn" title="No contract configured">Set VITE_CONTRACT_ADDRESS first.</Notice>;
  if (cfg.error) return <Notice tone="error" title="Could not load config">{cfg.error}</Notice>;
  if (!cfg.data) return <p className="text-[13px] text-mist-500">Loading…</p>;
  if (!isOwner && !isMod) {
    return <Notice tone="warn" title="Not authorized">This page is for the owner or a moderator. Connected: {shortAddress(me)}</Notice>;
  }

  const c = cfg.data;
  const bpsFromInput = () => Math.round(Number(fee) * 100);

  return (
    <div className="space-y-12">
      <PageHeader title="Admin">
        Signed in as {isOwner ? "owner" : "moderator"}. Owner-only actions fail for moderators, and the contract enforces that.
      </PageHeader>

      <Card className="space-y-2 p-6">
        <SectionTitle>Marketplace state</SectionTitle>
        <p className="text-[14px] text-mist-200">Owner: <span className="font-mono">{shortAddress(c.owner)}</span></p>
        <p className="text-[14px] text-mist-200">Global pause: {c.global_paused ? "PAUSED" : "active"}</p>
        <p className="text-[14px] text-mist-200">Fee: {c.fee_bps / 100}% · Accrued fees: {fromWei(BigInt(c.accrued_fees), 6)} {NATIVE_SYMBOL}</p>
        <p className="text-[14px] text-mist-200">Held in escrow: {fromWei(BigInt(c.escrowed), 6)} {NATIVE_SYMBOL}</p>
        <p className="text-[13px] text-mist-400">Listings {c.listing_count} · Offers {c.offer_count} · Orders {c.order_count}</p>
      </Card>

      {localError && <HelperText tone="error">{localError}</HelperText>}

      <section className="space-y-4">
        <SectionTitle>Global pause</SectionTitle>
        <Card className="flex flex-wrap gap-3 p-5">
          <Button
            variant={c.global_paused ? "secondary" : "danger"}
            loading={busy === "pause"}
            onClick={() => void run("pause", (s) => setGlobalPause(s, !c.global_paused), c.global_paused ? "Marketplace resumed" : "Marketplace paused", "New listings, offers and purchases are blocked.")}
          >
            {c.global_paused ? "Resume marketplace" : "Pause marketplace"}
          </Button>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionTitle>Listings and disputes</SectionTitle>
        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <Label>Restore listing id</Label>
              <Input type="number" min={0} value={restoreId} onChange={(e) => setRestoreId(e.target.value)} />
              <HelperText>Only listings hidden by community reports can be restored.</HelperText>
            </div>
            <Button variant="secondary" loading={busy === "restore"} disabled={restoreId === ""} onClick={() => void run("restore", (s) => restoreListing(s, Number(restoreId)), "Listing restored")}>
              Restore
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <Label>Disputed order id</Label>
              <Input type="number" min={0} value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
            </div>
            <Button loading={busy === "dref"} disabled={disputeId === ""} onClick={() => void run("dref", (s) => resolveDisputeManually(s, Number(disputeId), true), "Buyer refunded")}>Refund buyer</Button>
            <Button variant="secondary" loading={busy === "drel"} disabled={disputeId === ""} onClick={() => void run("drel", (s) => resolveDisputeManually(s, Number(disputeId), false), "Seller paid")}>Pay seller</Button>
          </div>
        </Card>
      </section>

      {isOwner && (
        <>
          <section className="space-y-4">
            <SectionTitle>Categories</SectionTitle>
            <Card className="space-y-4 p-6">
              <ul className="space-y-2 text-[14px] text-mist-200">
                {(cats.data ?? []).map((cat) => (
                  <li key={cat.slug} className="flex items-center justify-between gap-3">
                    <span>{cat.name} <span className="font-mono text-[12px] text-mist-500">{cat.slug}</span></span>
                    <Button variant="ghost" loading={busy === `cat-${cat.slug}`} onClick={() => void run(`cat-${cat.slug}`, (s) => setCategoryActive(s, cat.slug, !cat.active), cat.active ? "Category closed" : "Category opened")}>
                      {cat.active ? "Close" : "Open"}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-3 border-t border-deep-700 pt-4">
                <div><Label hint="a-z, 0-9, -">Slug</Label><Input maxLength={24} value={catSlug} onChange={(e) => setCatSlug(e.target.value)} /></div>
                <div><Label>Name</Label><Input maxLength={40} value={catName} onChange={(e) => setCatName(e.target.value)} /></div>
                <Button variant="secondary" loading={busy === "addcat"} disabled={!catSlug || !catName} onClick={() => void run("addcat", (s) => addCategory(s, catSlug.trim(), catName.trim()), "Category added")}>Add category</Button>
              </div>
            </Card>
          </section>

          <section className="space-y-4">
            <SectionTitle>Fees and withdrawals</SectionTitle>
            <Card className="flex flex-wrap items-end gap-3 p-6">
              <div>
                <Label hint={`max ${MAX_FEE_BPS / 100}%`}>Platform fee (%)</Label>
                <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <Button
                variant="secondary"
                loading={busy === "fee"}
                onClick={() => {
                  const bps = bpsFromInput();
                  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) {
                    setLocalError(`Fee must be between 0 and ${MAX_FEE_BPS / 100}%.`);
                    return;
                  }
                  setLocalError(null);
                  void run("fee", (s) => setFeeBps(s, bps), "Fee updated");
                }}
              >
                Save fee
              </Button>
              <Button variant="secondary" loading={busy === "wf"} disabled={c.accrued_fees === 0} onClick={() => void run("wf", (s) => withdrawFees(s), "Fees withdrawn")}>
                Withdraw {fromWei(BigInt(c.accrued_fees), 6)} {NATIVE_SYMBOL}
              </Button>
            </Card>
          </section>

          <section className="space-y-4">
            <SectionTitle>Moderators</SectionTitle>
            <Card className="flex flex-wrap items-end gap-3 p-6">
              <div className="min-w-[16rem] flex-1">
                <Label>Wallet</Label>
                <Input className="font-mono" value={modWallet} onChange={(e) => setModWallet(e.target.value)} placeholder="0x…" />
              </div>
              <Button variant="secondary" loading={busy === "modadd"} disabled={!isValidAddress(modWallet)} onClick={() => void run("modadd", (s) => setModerator(s, normalizeAddress(modWallet), true), "Moderator added")}>Add</Button>
              <Button variant="danger" loading={busy === "modrm"} disabled={!isValidAddress(modWallet)} onClick={() => void run("modrm", (s) => setModerator(s, normalizeAddress(modWallet), false), "Moderator removed")}>Remove</Button>
            </Card>
          </section>

          <section className="space-y-4">
            <SectionTitle>Transfer ownership</SectionTitle>
            <Card className="space-y-4 p-6">
              <p className="text-[13px] text-mist-400">Two steps: the owner proposes, and the new owner accepts from their own wallet.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[16rem] flex-1">
                  <Label>New owner</Label>
                  <Input className="font-mono" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} placeholder="0x…" />
                </div>
                <Button variant="secondary" loading={busy === "propose"} disabled={!isValidAddress(newOwner)} onClick={() => void run("propose", (s) => proposeOwner(s, normalizeAddress(newOwner)), "Ownership proposed")}>Propose</Button>
              </div>
            </Card>
          </section>
        </>
      )}

      {isMod && !isOwner && (
        <Notice tone="info">Category, fee, moderator and ownership actions are for the owner only.</Notice>
      )}

      {!isOwner && (
        <Card className="p-5">
          <p className="text-[13px] text-mist-400">Owner-only transfer acceptance: if you were proposed as the new owner, accept here.</p>
          <div className="mt-3">
            <Button variant="secondary" loading={busy === "accept"} onClick={() => void run("accept", (s) => acceptOwnership(s), "Ownership accepted")}>Accept ownership</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
