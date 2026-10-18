import { useState } from "react";
import { Button, Card, PageHeader } from "../components/ui";
import { getConfig, listCategories, searchListings } from "../lib/client";
import { activeNetworkLabel, CONTRACT_ADDRESS, isContractConfigured } from "../lib/networks";

/** Calls a few contract views and shows the raw answer or error. Run it first when something looks wrong. */
export function Diagnostics() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const checks: [string, () => Promise<unknown>][] = [
    ["get_config", () => getConfig()],
    ["list_categories", () => listCategories()],
    ["search_listings (first 5)", () => searchListings("", "", 0n, 0n, 0, 5)],
  ];

  const run = async () => {
    setBusy(true);
    const out: Record<string, string> = {};
    for (const [name, fn] of checks) {
      try {
        out[name] = "OK\n" + JSON.stringify(await fn(), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
      } catch (e) {
        out[name] = "FAILED\n" + (e instanceof Error ? e.message : String(e));
      }
    }
    setResults(out);
    setBusy(false);
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Connection check">Reads the contract on {activeNetworkLabel}.</PageHeader>
      <Card className="space-y-3 p-6">
        <p className="font-mono text-[12px] text-mist-400">{isContractConfigured ? CONTRACT_ADDRESS : "No contract address set"}</p>
        <Button loading={busy} disabled={!isContractConfigured} onClick={() => void run()}>Run checks</Button>
      </Card>
      {Object.entries(results).map(([name, text]) => (
        <Card key={name} className="p-5">
          <p className="text-[14px] font-medium text-mist-100">{name}</p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-deep-700 bg-deep-950 p-3 text-[12px] text-mist-300">{text}</pre>
        </Card>
      ))}
    </div>
  );
}
