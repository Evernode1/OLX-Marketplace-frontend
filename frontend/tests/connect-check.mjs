// Live read check against the deployed contract. Run after `npm install`:
//   VITE_CONTRACT_ADDRESS=0x... node tests/connect-check.mjs
import { createClient } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import { createGenLayerAdapter } from "../src/lib/adapter.js";

const networkKey = process.env.VITE_GENLAYER_NETWORK || "studionet";
const address = process.env.VITE_CONTRACT_ADDRESS || "";
const chain = chains[networkKey];
if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.log("Set VITE_CONTRACT_ADDRESS (and a valid VITE_GENLAYER_NETWORK).");
  process.exit(1);
}
const adapter = createGenLayerAdapter(createClient({ chain }), address);
let failed = 0;
for (const [name, fn] of [["get_config", () => adapter.getConfig()], ["list_categories", () => adapter.listCategories()], ["search_listings", () => adapter.searchListings("", "", 0, 0, 0, 5)]]) {
  try {
    console.log(`OK     ${name}\n       ${JSON.stringify(await fn(), (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  } catch (e) {
    failed++;
    console.log(`FAILED ${name}\n       ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
