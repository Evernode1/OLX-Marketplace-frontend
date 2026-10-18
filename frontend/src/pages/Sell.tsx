import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { Button, Card, HelperText, Input, Label, Notice, PageHeader, SectionTitle, Select, Textarea } from "../components/ui";
import { useRunner } from "../hooks/useRunner";
import { usePolled } from "../hooks/usePolled";
import {
  acceptOffer, createListing, getConfig, getIncomingOffers, getListing, getSellerListings, listCategories,
  rejectOffer, releaseReservation, setProfileName, updateListing, getProfile,
} from "../lib/client";
import { fromWei, NATIVE_SYMBOL, toWei, shortAddress, formatIsoTimestamp } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { CONDITIONS, LISTING_STATUS, MAX_DESC, MAX_NAME, MAX_TITLE, OFFER_STATUS, parseContractError, validateListing } from "../lib/rules.js";
import type { Listing, Offer } from "../lib/types";

const EMPTY = { title: "", description: "", category: "", price: "", city: "", imageUri: "", condition: "used" };

export function Sell() {
  const wallet = useWallet();
  const me = wallet.address;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get("edit");

  const cats = usePolled(() => listCategories(), [], 60_000);
  const cfg = usePolled(() => getConfig(), [], 30_000, isContractConfigured);
  const mine = usePolled(
    async () => (me ? (await getSellerListings(me, 0, 50)).items : []),
    [me],
    30_000,
    isContractConfigured && !!me,
  );
  const offers = usePolled(
    async () => (me && cfg.data ? await getIncomingOffers(me, cfg.data.offer_count) : []),
    [me, cfg.data?.offer_count],
    30_000,
    isContractConfigured && !!me && !!cfg.data,
  );
  const profile = usePolled(() => (me ? getProfile(me) : Promise.resolve("")), [me], 60_000, !!me);

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");

  const refreshAll = async () => {
    await Promise.all([mine.refresh(), offers.refresh(), cfg.refresh()]);
  };
  const { busy, run } = useRunner(refreshAll);

  // Load an existing listing into the form when arriving from "Edit listing".
  useEffect(() => {
    if (!editId) {
      setEditing(null);
      setForm(EMPTY);
      return;
    }
    void (async () => {
      try {
        const l: Listing = await getListing(Number(editId));
        if (!me || l.seller.toLowerCase() !== me.toLowerCase()) return;
        setEditing(Number(editId));
        setForm({
          title: l.title,
          description: l.description,
          category: l.category,
          price: fromWei(BigInt(l.price), 18),
          city: l.city,
          imageUri: l.image_uri,
          condition: l.condition,
        });
      } catch (e) {
        setErrors([parseContractError(e).message]);
      }
    })();
  }, [editId, me]);

  const submit = async () => {
    let priceWei: bigint;
    try {
      priceWei = toWei(form.price || "0");
    } catch {
      setErrors(["Enter the price as a plain number, for example 0.5"]);
      return;
    }
    const errs = validateListing({ ...form, priceWei });
    setErrors(errs);
    if (errs.length || !wallet.signer) return;
    const payload = { ...form, priceWei };
    const ok = editing === null
      ? await run("save", (s) => createListing(s, payload), "Listing published")
      : await run("save", (s) => updateListing(s, editing, payload), "Listing updated");
    if (ok) {
      setForm(EMPTY);
      if (editing !== null) navigate("/sell");
    }
  };

  const catOptions = (cats.data ?? []).filter((c) => c.active);

  return (
    <div className="space-y-12">
      <PageHeader title="Sell">
        Publish an item, manage your listings, and respond to offers. Each new listing passes an AI policy check before it is saved.
      </PageHeader>

      {!isContractConfigured && <Notice tone="warn" title="No contract configured">Set VITE_CONTRACT_ADDRESS first.</Notice>}
      {!me && <Notice tone="info" title="Connect a wallet">You need a wallet to sell.</Notice>}

      {me && (
        <section className="space-y-4">
          <SectionTitle>Display name</SectionTitle>
          <Card className="flex flex-wrap items-end gap-3 p-5">
            <div className="min-w-[14rem] flex-1">
              <Label hint={`${MAX_NAME} max`}>Shown on your listings{profile.data ? `: ${profile.data}` : ""}</Label>
              <Input maxLength={MAX_NAME} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or shop" />
            </div>
            <Button variant="secondary" loading={busy === "name"} disabled={!name.trim()} onClick={() => void run("name", (s) => setProfileName(s, name.trim()), "Name saved")}>
              Save name
            </Button>
          </Card>
        </section>
      )}

      <section className="space-y-4">
        <SectionTitle aside={editing !== null ? <Link to="/sell" className="text-[13px] text-mist-400">Cancel edit</Link> : null}>
          {editing !== null ? `Edit listing #${editing}` : "New listing"}
        </SectionTitle>
        <Card className="grid gap-4 p-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label hint={`${form.title.length}/${MAX_TITLE}`}>Title</Label>
            <Input maxLength={MAX_TITLE} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label hint={`${form.description.length}/${MAX_DESC}`}>Description</Label>
            <Textarea maxLength={MAX_DESC} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Choose a category</option>
              {catOptions.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Condition</Label>
            <Select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint={NATIVE_SYMBOL}>Price</Label>
            <Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.5" />
          </div>
          <div>
            <Label>City</Label>
            <Input maxLength={60} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label hint="https:// only, optional">Image URL</Label>
            <Input value={form.imageUri} onChange={(e) => setForm({ ...form, imageUri: e.target.value })} placeholder="https://" />
          </div>
          <div className="space-y-2 md:col-span-2">
            {errors.map((e) => (
              <HelperText key={e} tone="error">{e}</HelperText>
            ))}
            <Button loading={busy === "save"} disabled={!me || !isContractConfigured} onClick={() => void submit()}>
              {editing !== null ? "Save changes" : "Publish listing"}
            </Button>
          </div>
        </Card>
      </section>

      {me && (
        <section className="space-y-4">
          <SectionTitle>My listings</SectionTitle>
          {(mine.data ?? []).length === 0 && <p className="text-[13px] text-mist-500">You have not listed anything yet.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {(mine.data ?? []).map((l) => (
              <Card key={l.id} className="flex items-start justify-between gap-3 p-4">
                <div>
                  <Link to={`/listing/${l.id}`} className="font-display text-[15px] text-mist-100 hover:text-beacon-300">{l.title}</Link>
                  <p className="text-[13px] text-mist-400">
                    {fromWei(BigInt(l.price), 4)} {NATIVE_SYMBOL} · {LISTING_STATUS[l.status as keyof typeof LISTING_STATUS] ?? l.status}
                  </p>
                </div>
                <Link to={`/sell?edit=${l.id}`} className="shrink-0 text-[13px] text-beacon-300">Edit</Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      {me && (
        <section className="space-y-4">
          <SectionTitle>Incoming offers</SectionTitle>
          {(offers.data ?? []).length === 0 && <p className="text-[13px] text-mist-500">No offers on your listings yet.</p>}
          <div className="space-y-3">
            {(offers.data ?? []).map((o: Offer) => (
              <Card key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="text-[13px] text-mist-300">
                  <p>Offer #{o.id} on listing #{o.listing_id} · <span className="font-medium text-mist-100">{fromWei(BigInt(o.amount), 4)} {NATIVE_SYMBOL}</span></p>
                  <p className="text-mist-500">From {shortAddress(o.buyer)} · {OFFER_STATUS[o.status as keyof typeof OFFER_STATUS] ?? o.status} · {formatIsoTimestamp(o.created_at)}</p>
                </div>
                <div className="flex gap-2">
                  {o.status === "open" && (
                    <>
                      <Button loading={busy === `acc-${o.id}`} onClick={() => void run(`acc-${o.id}`, (s) => acceptOffer(s, o.id), "Offer accepted", "The buyer has 7 days to pay.")}>Accept</Button>
                      <Button variant="secondary" loading={busy === `rej-${o.id}`} onClick={() => void run(`rej-${o.id}`, (s) => rejectOffer(s, o.id), "Offer rejected")}>Reject</Button>
                    </>
                  )}
                  {o.status === "accepted" && (
                    <Button variant="secondary" loading={busy === `rel-${o.id}`} onClick={() => void run(`rel-${o.id}`, (s) => releaseReservation(s, o.id), "Reservation released", "Only works after the buyer's 7-day payment window.")}>
                      Release if unpaid
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
