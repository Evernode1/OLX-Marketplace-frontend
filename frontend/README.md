# Marketplace frontend

React + TypeScript + Vite app for the Marketplace intelligent contract (`../contracts/Marketplace.py`).
It uses the same wallet, network and UI structure as the EventAttendance frontend.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Browse listings with category, city and price filters |
| `/listing/:id` | Listing details, buy now, make an offer, watch, report, and for the seller: edit, pause, remove |
| `/sell` | Create or edit a listing, set a display name, accept, reject or release incoming offers |
| `/offers` | Offers you made: pay accepted offers, withdraw open ones |
| `/orders` | Purchases and sales: escrow actions, disputes, ratings |
| `/admin` | Owner and moderator controls: pause, categories, fee, moderators, dispute override, restores |
| `/check` | Raw result of a few contract views |

## Run

```
cp .env.example .env.local   # already set to the deployed address
npm install
npm run dev
npm test                     # validation rules
npm run build
```

## Configuration

- `VITE_CONTRACT_ADDRESS`: the Marketplace contract for the network in `VITE_GENLAYER_NETWORK`.
- Users can also paste an address in the network menu.

## Known limits

- Offers and orders have no per-user index on chain. Incoming offers, my offers, and the Offers page scan the most
  recent 300 offer ids. Older offers will not appear. Orders use the contract's per-buyer and per-seller indexes.
- Writes use the connected wallet. Built-in wallets are for testnets only.
- Listing images are shown from the https URL the seller provides. The contract does not check them.
