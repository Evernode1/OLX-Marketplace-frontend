import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, HelperText, Input, Label, Notice, PageHeader, Select } from "../components/ui";
import { usePolled } from "../hooks/usePolled";
import { listCategories, searchListings } from "../lib/client";
import { fromWei, NATIVE_SYMBOL, toWei } from "../lib/format";
import { isContractConfigured } from "../lib/networks";
import { LISTING_STATUS, PAGE_SIZE, parseContractError } from "../lib/rules.js";
import type { Listing } from "../lib/types";

export function Browse() {
  const cats = usePolled(() => listCategories(), [], 60_000);
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [items, setItems] = useState<Listing[]>([]);
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (reset: boolean) => {
    let lo: bigint;
    let hi: bigint;
    try {
      lo = minPrice.trim() ? toWei(minPrice) : 0n;
      hi = maxPrice.trim() ? toWei(maxPrice) : 0n;
    } catch {
      setError("Enter prices as plain numbers, for example 0.5");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const from = reset ? 0 : offset;
      const page = await searchListings(category, city.trim(), lo, hi, from, PAGE_SIZE);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setOffset(Number(page.next_offset));
      setDone(Boolean(page.done));
    } catch (e) {
      setError(parseContractError(e).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isContractConfigured) void search(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader title="Browse listings" actions={<Link to="/sell" className="inline-flex"><Button variant="secondary">Sell an item</Button></Link>}>
        Find items by category, city and price. Payments are held in escrow until the buyer confirms delivery.
      </PageHeader>

      {!isContractConfigured && <Notice tone="warn" title="No contract configured">Set VITE_CONTRACT_ADDRESS to load listings.</Notice>}

      <Card className="grid gap-4 p-5 md:grid-cols-4">
        <div>
          <Label>Category</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(cats.data ?? []).filter((c) => c.active).map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>City</Label>
          <Input value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} placeholder="Any city" />
        </div>
        <div>
          <Label hint={NATIVE_SYMBOL}>Min price</Label>
          <Input inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="0" />
        </div>
        <div>
          <Label hint={NATIVE_SYMBOL}>Max price</Label>
          <Input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Any" />
        </div>
        <div className="md:col-span-4">
          <Button loading={loading} onClick={() => void search(true)} disabled={!isContractConfigured}>Search</Button>
        </div>
      </Card>

      {error && <HelperText tone="error">{error}</HelperText>}
      {!loading && items.length === 0 && isContractConfigured && !error && (
        <EmptyState title="No listings match">Try a wider price range or another category.</EmptyState>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {items.map((l) => (
          <Link key={l.id} to={`/listing/${l.id}`} className="block">
            <Card className="flex h-full flex-col gap-2 p-5 transition-colors hover:border-beacon-400">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-[16px] text-mist-100">{l.title}</h3>
                <span className="shrink-0 rounded-full border border-deep-600 px-2 py-0.5 text-[11px] text-mist-400">
                  {LISTING_STATUS[l.status as keyof typeof LISTING_STATUS] ?? l.status}
                </span>
              </div>
              <p className="text-[15px] font-medium text-beacon-300">{fromWei(BigInt(l.price), 4)} {NATIVE_SYMBOL}</p>
              <p className="mt-auto text-[12px] text-mist-500">
                {l.city || "City not given"} · {l.condition} · {l.category}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {items.length > 0 && !done && (
        <Button variant="secondary" loading={loading} onClick={() => void search(false)}>Load more</Button>
      )}
    </div>
  );
}
