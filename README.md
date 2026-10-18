# Marketplace (OLX-style classifieds on GenLayer)

An intelligent contract for a classifieds marketplace: listings, search, offers, buy-now, escrow, AI-decided
disputes, ratings, moderation and fees. This repository contains only the contract, its tests and its
documentation. The frontend is in `frontend/` (React + Vite).

- Contract: `contracts/Marketplace.py`
- Frontend (React + Vite): `frontend/`, see `frontend/README.md`
- Tests (gltest style): `tests/direct/test_marketplace.py`, fixtures in `tests/direct/conftest.py`
- Offline runner (shim, not gltest): `tests/offline/run_offline.py`
- Design decisions and open verification items: `DECISION.md`
- Deployment record and hash check: `deploy/manifest.json`, `deploy/check_manifest.py`

Currency is the network's native token. Amounts are in wei.

**Ids.** Write functions return nothing, the same as the EventAttendance contract. After a `create_listing`,
`make_offer`, `buy_now` or `pay_offer`, read the new id from `get_config()`: `listing_count`, `offer_count`
and `order_count` are the next ids, so the id just created is `count - 1`.

**Return shapes.** Views return dicts or simple scalars. Lists are wrapped as `{"items": [...]}`, and counts as
`{"count": n}`.

## How it works

**Sell.** A seller creates a listing in an open category with a title, description, price, city, optional
https image and condition. An LLM policy check runs first. A blocked listing is not stored.

**Buy.** A buyer either pays the listed price (`buy_now`) or makes an offer. The seller can accept an offer,
which reserves the listing for that buyer, and the buyer then pays the accepted amount (`pay_offer`) within
7 days.

**Deliver and settle.** The seller marks the order delivered. The buyer confirms receipt, and the seller is
paid the price minus the fee. If the buyer does nothing for 7 days after delivery, anyone can release the
payment (`auto_release`).

**Dispute.** After delivery, the buyer can open a dispute with a claim. The seller has 3 days to respond.
Without a response the buyer is refunded. With a response, an LLM verdict decides between refund and
release. A moderator can override.

**Trust.** Listing text and disputes are untrusted and are passed to the LLM inside tags. Verdicts are a
closed set of values. See `DECISION.md` for the reasoning and the risks.

## Contract API

| Area | Functions |
| --- | --- |
| Listings | `create_listing`, `update_listing`, `set_listing_paused`, `remove_listing`, `restore_listing` (mod, auto-hidden only), `report_listing`, `watch_listing` |
| Search | `search_listings`, `seller_listings`, `get_listing`, `get_watch_count`, `is_watching`, `get_report_count` |
| Offers | `make_offer`, `withdraw_offer`, `reject_offer`, `accept_offer`, `pay_offer` (payable), `release_reservation`, `get_offer` |
| Orders | `buy_now` (payable), `mark_delivered`, `confirm_receipt`, `auto_release`, `cancel_order`, `open_dispute`, `respond_dispute`, `resolve_dispute`, `resolve_dispute_manually` (mod), `get_order`, `buyer_orders`, `seller_orders` |
| Ratings | `rate_counterparty`, `get_reputation`, `get_review` |
| Categories | `list_categories`, `add_category` (owner), `set_category_active` (owner) |
| Profile | `set_profile_name`, `get_profile` |
| Admin | `set_fee_bps` (owner, max 500), `withdraw_fees` (owner), `set_moderator` (owner), `set_global_pause` (owner or mod), `propose_owner`, `accept_ownership`, `is_moderator`, `get_config` |

Default categories: vehicles, electronics, property, fashion, home, services, jobs, other. The owner can add
more.

Default fee: 2.5% (250 basis points). Time windows: pay 7 days, delivery 14 days after payment, confirm 7
days after delivery, dispute response 3 days.

## Running the tests

The gltest suite is in `tests/direct/`. Run it with gltest against the SDK your GenLayer setup uses. The
fixtures (`direct_deploy`, `direct_vm`, `direct_alice`, and the others) follow the same convention as the
EventAttendance contract in this repository.

To run the suite without a network, use the offline shim:

```
python3 tests/offline/run_offline.py .
```

The shim does not replace gltest or StudioNet. Use it to catch logic errors quickly. Native transfers are
recorded in the shim and checked where available. Under real gltest those checks are skipped, so the
settlement tests verify contract state, not the transfer itself.

## Integration tests (value flow)

`tests/integration/test_value_flow.py` runs on studionet through gltest Studio mode. It covers the
inbound payable purchase, the buyer refund, the seller release, and the fee withdrawal, and it checks
the escrow invariant on-chain. Fund the test accounts first. See `tests/integration/README.md`.

    gltest --network studionet tests/integration -v

## Before deploying

1. Confirm the items in "Must verify before deployment" in `DECISION.md`, especially the native transfer
   interface and the payable decorator.
2. Run the gltest suite on StudioNet and fix anything it reports.
3. Deploy the exact source file. Record the address, `deployed_source_sha256` and `deployed_at` in
   `deploy/manifest.json`, then run `python3 deploy/check_manifest.py`.

The current `deploy/manifest.json` records the source hash of this version and `deployed: false`.
