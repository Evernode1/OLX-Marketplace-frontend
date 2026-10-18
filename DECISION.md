# Marketplace v0.1 -- design decisions

This document records what the marketplace contract does, why it is built that way, and what is still
unverified. It is written so a reviewer can check each decision against the code and the tests.

## Scope

A classifieds marketplace in the style of OLX: sellers list items, buyers search and make offers or buy
now, and money is held in escrow until the buyer is satisfied. The contract is a single file,
`contracts/Marketplace.py`. There is no frontend in this version.

## Decisions

**1. Escrow with an explicit buyer confirmation.** Funds for `buy_now` and `pay_offer` are held by the
contract. They leave only when the buyer calls `confirm_receipt`, when the confirmation window passes
(`auto_release`), or when a dispute is resolved. This avoids the common failure where a seller is paid
before delivery, or a buyer pays and the seller never ships. The seller can cancel an unfulfilled order at
any time, which refunds the buyer. The buyer can cancel only after the delivery window passes.

**2. Offers reserve the listing before payment.** Accepting an offer marks the listing `reserved` for that
buyer. The buyer then pays the exact accepted amount within 7 days. If they do not, the seller can release
the reservation. This is the only way a second buyer is kept out while one buyer is paying, and it avoids
taking money from a buyer whose offer the seller has not accepted.

**3. Disputes are decided by a consensus-checked LLM verdict, with a default and a moderator override.**
After delivery, the buyer can open a dispute with a claim. The seller has 3 days to respond. If the seller
does not respond, the claim stands and the buyer is refunded. If the seller responds, an LLM compares the
listing text, the claim and the response and returns `buyer` or `seller`. Moderators can override any
dispute. The verdict is a closed set of two values, so a validator can only disagree on the verdict, not
on free text.

**4. Money moves in a small number of places.** Inbound: `buy_now`, `pay_offer`. Outbound: `confirm_receipt`,
`auto_release`, `resolve_dispute`, `cancel_order`, `withdraw_fees`. The contract tracks `escrowed` (the sum
of unreleased order amounts) and `accrued_fees` separately, and the tests check that both return to zero
after orders settle.

**5. Every listing passes an LLM policy check.** The check runs inside `create_listing` and
`update_listing`. The listing text is untrusted, so it is placed inside tags and the prompt says to ignore
instructions in it. A blocked listing is never stored. A failed check returns `[LLM_ERROR]` and nothing is
written, so the seller can retry.

**6. Community reports hide a listing at a threshold.** Three distinct reporters, none of them the seller,
hide an active or paused listing from search. A moderator can restore an auto-hidden listing. Removals by
the seller or a moderator are final, so a restore never overrides an explicit removal. The seller cannot
report their own listing.

**7. Search scans with a cap.** Views have no gas limit on the caller's side, but the contract still
bounds the work: `search_listings` scans at most 500 listing ids per call and returns at most 50 items.
It returns a cursor (`next_offset`) and a `done` flag, so a client pages through the full range.
Per-seller and per-buyer lists use indexes written at creation time, so those reads do not scan.

**8. Ratings are one per side per order.** Only completed orders can be rated. The buyer rates the seller
and the seller rates the buyer, each once. Ratings are stored as a sum and a count, so the average is
computed on read.

**9. Fees are capped.** The fee is set in basis points, default 2.5%, and the owner can set it between 0 and
5%. Fees are accrued per order and withdrawn by the owner.

**10. Roles.** The owner sets fees, categories, moderators and ownership (two-step transfer). Moderators
and the owner can pause the marketplace, restore listings, and resolve disputes manually. Sellers manage
only their own listings and orders. Buyers manage only their own offers and orders.

## Schema compatibility

Studio builds a schema from the contract's public methods and loads the module before it deploys. These
choices keep the module in the same shape as the deployed EventAttendance contract:

- Write functions return nothing. Ids are read from the counters in `get_config()`.
- Views return dicts, bools or strings. Lists are wrapped in a dict, and counts are returned as `{"count": n}`.
- The native transfer interface is created inside `_send` when it is first needed, not at import time.

The `@gl.public.write.payable` decorator is the one construct EventAttendance does not use. It is needed for
`buy_now` and `pay_offer` to accept funds. If Studio still fails to load the schema after the changes above,
remove the payable decorators to confirm that they are the cause, then check the SDK's documented form.

## Research basis

- **OLX and similar classifieds:** listing, category and location filtering, seller pages, and buyer and
  seller messaging. Messaging is out of scope on chain; the contract stores only the order state.
- **Escrow with buyer confirmation and timed auto-release:** the pattern used by marketplace buyer
  protection systems, where funds release after confirmation or a timeout.
- **Two-step ownership transfer and role separation:** taken from the EventAttendance contract in this
  repository so both contracts follow the same administration model.
- **LLM-decided disputes with a closed verdict set:** the same approach as the attendance verification
  in EventAttendance, applied to a dispute decision.

## Trade-offs and residual risk

- **Native token only.** No token standard support. Listing prices are in wei. A stablecoin or ERC-20
  payment path would need its own design.
- **Messaging and images are off chain.** The contract stores an https image URL and text only. The
  image is not checked, so an image can show something the policy check did not see.
- **LLM decisions are as reliable as the consensus rule.** Both the policy check and the dispute verdict use
  `strict_eq` over the verdict JSON. That works only if validators produce the same verdict. A production
  version should use a non-comparative equivalence principle for free-form judgments. This is listed in
  "Must verify before deployment".
- **Restoring a listing clears its report count, but not the reporter flags.** A user who already reported a
  listing cannot report it again, even after a restore. This is deliberate for now, because the contract
  cannot enumerate and clear per-reporter flags cheaply.
- **Disputes are evidence-light.** The claim and response are short text. There is no evidence upload and
  no appeal beyond the moderator override.
- **Ratings can be given only after completion, and they cannot be revised.** There is no review of
  abuse of ratings.
- **Cancelled and removed listings stay in storage.** Ids are not reused, so storage grows with every
  listing. This is acceptable for a testnet version.
- **Escrow is only as good as the transfer call.** See the verification list below.

## SDK alignment (v0.2.5 docs)

Checked against the GenLayer SDK v0.2.5 API reference:

- **Native transfer.** `_send` uses `gl.evm.contract_interface` with a declaration class that has nested
  `View` and `Write` classes, then `payee(Address(to)).emit_transfer(value=u256(amount))`. Both
  `contract_interface` and `ContractProxy.emit_transfer(**data)` are documented, and `value` is part of
  `TransactionDataKwArgs`.
- **Payable.** `buy_now` and `pay_offer` use `@gl.public.write.payable` and read `gl.message.value`. Both are
  documented.
- **Balance.** `get_contract_balance` and `escrow_check` read `self.balance`, which is the documented
  `gl.Contract.balance` property. The escrow invariant (`balance == escrowed + accrued_fees`) is checked
  on-chain by the integration tests.

Still open:

1. **Pin alignment.** The `Depends` header pins `py-genlayer:1jb45aa8...`. I could not map that hash to the
   v0.2.5 docs, so confirm the pinned SDK is v0.2.5 (or update the pin) before deploying.
2. **Live run.** Run `gltest --network studionet tests/integration` on a funded account set. The tests
   assume `accounts[i].address` and a receipt field `hash` or `transaction_hash`, which I could not confirm
   from the docs. Adjust them if the live run shows otherwise.
3. **Dispute paths.** `resolve_dispute` depends on consensus over an LLM verdict. Only the non-LLM value paths
   are covered by the integration tests.
4. **Direct mode.** gltest direct mode does not enforce `@payable` and does not move balances. Value
   behaviour is therefore tested only in `tests/integration/`, never in `tests/direct/`.

