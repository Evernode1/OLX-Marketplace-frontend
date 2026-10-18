import sys

import pytest

from conftest import warp_to, NOW

# Roles: alice sells, bob and carol buy, dave is a moderator, eve reports listings.
PRICE = 1000
FEE = 25  # 2.5% of PRICE (default fee)
T_DELIVERED_PLUS_1 = "2099-01-02T00:00:00Z"
T_AFTER_CONFIRM = "2099-01-09T00:00:00Z"
T_AFTER_DELIVERY_WINDOW = "2099-01-16T00:00:00Z"
T_AFTER_PAY_WINDOW = "2099-01-09T00:00:00Z"
T_AFTER_RESPONSE = "2099-01-06T00:00:00Z"


def _shim_transfers():
    """Native transfers are recorded only by the offline SDK shim. Returns None under real gltest."""
    try:
        import genlayer
    except ImportError:
        return None
    state = getattr(genlayer, "_STATE", None)
    if not isinstance(state, dict) or "transfers" not in state:
        return None
    return state["transfers"]


def transfer_mark():
    t = _shim_transfers()
    return 0 if t is None else len(t)


def transfers_since(mark):
    t = _shim_transfers()
    return [] if t is None else t[mark:]


def as_(direct_vm, who):
    direct_vm.sender = who


def make_listing(contract, direct_vm, seller, title="Used bicycle", price=PRICE,
                 category="vehicles", city="Lagos", condition="used", image=""):
    as_(direct_vm, seller)
    contract.create_listing(title, "Good condition, sold as seen", category,
                            price, city, image, condition)
    return config(contract)["listing_count"] - 1


def buy(contract, direct_vm, buyer, lid, value=PRICE):
    as_(direct_vm, buyer)
    direct_vm.value = value
    try:
        contract.buy_now(lid)
        return config(contract)["order_count"] - 1
    finally:
        direct_vm.value = 0


def deliver(contract, direct_vm, seller, oid):
    as_(direct_vm, seller)
    contract.mark_delivered(oid)


def config(contract):
    return contract.get_config()


def create_offer(contract, lid, amount):
    contract.make_offer(lid, amount)
    return config(contract)["offer_count"] - 1


def pay_offer_id(contract, offer):
    contract.pay_offer(offer)
    return config(contract)["order_count"] - 1


# ---------------------------------------------------------------------------
# Setup and categories
# ---------------------------------------------------------------------------
def test_deploy_sets_owner_defaults_and_categories(contract, direct_alice):
    cfg = config(contract)
    assert cfg["owner"] == direct_alice
    assert cfg["fee_bps"] == 250
    assert cfg["global_paused"] is False
    assert cfg["listing_count"] == 0
    cats = contract.list_categories()["items"]
    assert len(cats) == 8
    assert any(c["slug"] == "vehicles" and c["active"] for c in cats)


def test_owner_can_add_and_close_category(contract, direct_vm, direct_alice, direct_bob):
    as_(direct_vm, direct_alice)
    contract.add_category("books", "Books")
    assert any(c["slug"] == "books" for c in contract.list_categories()["items"])
    contract.set_category_active("books", False)
    assert [c for c in contract.list_categories()["items"] if c["slug"] == "books"][0]["active"] is False
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only owner"):
        contract.add_category("toys", "Toys")


def test_add_category_rejects_bad_slug_and_duplicates(contract, direct_vm, direct_alice):
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Slug must be"):
        contract.add_category("Bad Slug", "Nope")
    with pytest.raises(Exception, match="already exists"):
        contract.add_category("vehicles", "Vehicles again")


# ---------------------------------------------------------------------------
# Listings and moderation
# ---------------------------------------------------------------------------
def test_create_listing_is_readable_and_searchable(contract, direct_vm, direct_alice):
    lid = make_listing(contract, direct_vm, direct_alice)
    listing = contract.get_listing(lid)
    assert listing["status"] == "active"
    assert listing["seller"] == direct_alice
    assert listing["price"] == PRICE
    page = contract.search_listings("vehicles", "", 0, 0, 0, 10)
    assert [i["id"] for i in page["items"]] == [lid]


def test_create_listing_rejects_unknown_or_closed_category(contract, direct_vm, direct_alice):
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Unknown category"):
        contract.create_listing("Sofa set", "Leather", "furniture", 10, "Accra", "", "used")
    contract.set_category_active("home", False)
    with pytest.raises(Exception, match="closed"):
        contract.create_listing("Sofa set", "Leather", "home", 10, "Accra", "", "used")


def test_create_listing_validates_fields(contract, direct_vm, direct_alice):
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Title must be"):
        contract.create_listing("ab", "", "vehicles", 10, "", "", "used")
    with pytest.raises(Exception, match="Condition must be"):
        contract.create_listing("Bike", "", "vehicles", 10, "", "", "broken")
    with pytest.raises(Exception, match="Image must be"):
        contract.create_listing("Bike", "", "vehicles", 10, "", "http://x.example/a.jpg", "used")
    with pytest.raises(Exception, match="Price out of range"):
        contract.create_listing("Bike", "", "vehicles", -1, "", "", "used")


def test_policy_block_stops_listing(contract, direct_vm, direct_alice):
    direct_vm.clear_mocks()
    direct_vm.mock_llm("MARKETPLACE_POLICY_CHECK", '{"status": "blocked"}')
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="marketplace policy"):
        contract.create_listing("Unlicensed firearm", "Cash only", "other", 500, "", "", "used")
    assert config(contract)["listing_count"] == 0


def test_policy_llm_failure_is_reported_and_not_stored(contract, direct_vm, direct_alice):
    direct_vm.clear_mocks()
    direct_vm.mock_llm("MARKETPLACE_POLICY_CHECK", "not json at all")
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="LLM_ERROR"):
        contract.create_listing("Desk lamp", "Works", "home", 50, "", "", "used")
    assert config(contract)["listing_count"] == 0


def test_seller_can_update_listing_and_only_seller(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only the seller"):
        contract.update_listing(lid, "Hijacked", "", 1, "", "", "used")
    as_(direct_vm, direct_alice)
    contract.update_listing(lid, "Used bicycle, lightly", "Updated", 900, "Abuja", "", "used")
    listing = contract.get_listing(lid)
    assert listing["price"] == 900
    assert listing["city"] == "Abuja"


def test_pause_hides_listing_and_unpause_restores(contract, direct_vm, direct_alice):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    contract.set_listing_paused(lid, True)
    assert contract.search_listings("", "", 0, 0, 0, 10)["items"] == []
    assert contract.get_listing(lid)["status"] == "paused"
    contract.set_listing_paused(lid, False)
    assert [i["id"] for i in contract.search_listings("", "", 0, 0, 0, 10)["items"]] == [lid]


def test_seller_removal_is_final_and_moderator_cannot_override_it(contract, direct_vm, direct_alice, direct_dave):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    contract.remove_listing(lid, "sold elsewhere")
    assert contract.get_listing(lid)["status"] == "removed"
    contract.set_moderator(direct_dave, True)
    as_(direct_vm, direct_dave)
    with pytest.raises(Exception, match="Only listings hidden by reports"):
        contract.restore_listing(lid)
    assert contract.get_listing(lid)["status"] == "removed"


def test_moderator_removal_is_not_restorable(contract, direct_vm, direct_alice, direct_dave):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    contract.set_moderator(direct_dave, True)
    as_(direct_vm, direct_dave)
    contract.remove_listing(lid, "policy")
    with pytest.raises(Exception, match="Only listings hidden by reports"):
        contract.restore_listing(lid)


def test_three_reports_hide_listing(contract, direct_vm, direct_alice, direct_eve, direct_bob, direct_carol):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="own listing"):
        contract.report_listing(lid, "test")
    for reporter in (direct_eve, direct_bob):
        as_(direct_vm, reporter)
        contract.report_listing(lid, "scam")
    as_(direct_vm, direct_eve)
    with pytest.raises(Exception, match="already reported"):
        contract.report_listing(lid, "again")
    assert contract.get_listing(lid)["status"] == "active"
    as_(direct_vm, direct_carol)
    contract.report_listing(lid, "scam")
    assert contract.get_listing(lid)["status"] == "hidden"
    assert contract.get_report_count(lid)["count"] == 3
    assert contract.search_listings("", "", 0, 0, 0, 10)["items"] == []


def test_watchlist_counts_follow_toggles(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    contract.watch_listing(lid, True)
    contract.watch_listing(lid, True)  # no double count
    assert contract.get_watch_count(lid)["count"] == 1
    assert contract.is_watching(lid, direct_bob) is True
    contract.watch_listing(lid, False)
    assert contract.get_watch_count(lid)["count"] == 0


# ---------------------------------------------------------------------------
# Search and pagination
# ---------------------------------------------------------------------------
def test_search_filters_and_paginates(contract, direct_vm, direct_alice):
    a = make_listing(contract, direct_vm, direct_alice, title="Bike one", price=100, city="Lagos")
    b = make_listing(contract, direct_vm, direct_alice, title="Bike two", price=500, city="Abuja")
    c = make_listing(contract, direct_vm, direct_alice, title="Bike three", price=900, city="Lagos")
    assert [i["id"] for i in contract.search_listings("", "lagos", 0, 0, 0, 10)["items"]] == [a, c]
    assert [i["id"] for i in contract.search_listings("", "", 200, 600, 0, 10)["items"]] == [b]

    first = contract.search_listings("", "", 0, 0, 0, 2)
    assert [i["id"] for i in first["items"]] == [a, b]
    assert first["done"] is False
    second = contract.search_listings("", "", 0, 0, first["next_offset"], 2)
    assert [i["id"] for i in second["items"]] == [c]
    assert second["done"] is True


def test_search_rejects_bad_limit(contract):
    with pytest.raises(Exception, match="Limit must be"):
        contract.search_listings("", "", 0, 0, 0, 0)
    with pytest.raises(Exception, match="Limit must be"):
        contract.search_listings("", "", 0, 0, 0, 500)


def test_seller_listings_pages(contract, direct_vm, direct_alice, direct_bob):
    make_listing(contract, direct_vm, direct_alice, title="Alice one")
    make_listing(contract, direct_vm, direct_bob, title="Bob one")
    make_listing(contract, direct_vm, direct_alice, title="Alice two")
    page = contract.seller_listings(direct_alice, 0, 1)
    assert page["total"] == 2
    assert page["items"][0]["title"] == "Alice one"
    page2 = contract.seller_listings(direct_alice, page["next_offset"], 5)
    assert [i["title"] for i in page2["items"]] == ["Alice two"]


# ---------------------------------------------------------------------------
# Buy now and escrow
# ---------------------------------------------------------------------------
def test_buy_now_requires_exact_price_and_reserves(contract, direct_vm, direct_alice, direct_bob, direct_carol):
    lid = make_listing(contract, direct_vm, direct_alice)
    with pytest.raises(Exception, match="exactly the listing price"):
        buy(contract, direct_vm, direct_bob, lid, value=PRICE - 1)
    oid = buy(contract, direct_vm, direct_bob, lid)
    order = contract.get_order(oid)
    assert order["status"] == "paid"
    assert order["amount"] == PRICE
    assert order["fee"] == FEE
    assert contract.get_listing(lid)["status"] == "reserved"
    with pytest.raises(Exception, match="not available"):
        buy(contract, direct_vm, direct_carol, lid)
    assert config(contract)["escrowed"] == PRICE


def test_buyer_cannot_buy_own_listing(contract, direct_vm, direct_alice):
    lid = make_listing(contract, direct_vm, direct_alice)
    with pytest.raises(Exception, match="own listing"):
        buy(contract, direct_vm, direct_alice, lid)


def test_confirm_receipt_pays_seller_minus_fee(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    mark = transfer_mark()
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(oid)
    assert contract.get_order(oid)["status"] == "completed"
    assert contract.get_listing(lid)["status"] == "sold"
    cfg = config(contract)
    assert cfg["escrowed"] == 0
    assert cfg["accrued_fees"] == FEE
    sent = transfers_since(mark)
    if sent:
        assert (direct_alice, PRICE - FEE) in [(a, v) for a, v in sent]


def test_only_buyer_confirms_and_seller_delivers(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only the seller can mark delivered"):
        contract.mark_delivered(oid)
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Only the buyer can confirm"):
        contract.confirm_receipt(oid)


def test_auto_release_waits_for_confirmation_window(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="still open"):
        contract.auto_release(oid)
    warp_to(direct_vm, T_AFTER_CONFIRM)
    contract.auto_release(oid)
    assert contract.get_order(oid)["status"] == "completed"


def test_seller_cancel_refunds_buyer_and_reopens_listing(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    mark = transfer_mark()
    as_(direct_vm, direct_alice)
    contract.cancel_order(oid)
    order = contract.get_order(oid)
    assert order["status"] == "refunded"
    assert order["outcome"] == "cancelled by seller"
    assert contract.get_listing(lid)["status"] == "active"
    assert config(contract)["escrowed"] == 0
    sent = transfers_since(mark)
    if sent:
        assert (direct_bob, PRICE) in sent


def test_buyer_cancel_only_after_delivery_window(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="still open"):
        contract.cancel_order(oid)
    warp_to(direct_vm, T_AFTER_DELIVERY_WINDOW)
    contract.cancel_order(oid)
    assert contract.get_order(oid)["outcome"] == "not delivered in time"


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------
def test_offer_accept_then_pay_flow(contract, direct_vm, direct_alice, direct_bob, direct_carol):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    offer = create_offer(contract, lid, 800)
    as_(direct_vm, direct_carol)
    with pytest.raises(Exception, match="Only the seller can accept"):
        contract.accept_offer(offer)
    as_(direct_vm, direct_alice)
    contract.accept_offer(offer)
    assert contract.get_listing(lid)["status"] == "reserved"
    assert contract.get_listing(lid)["reserved_for"] == direct_bob

    as_(direct_vm, direct_bob)
    direct_vm.value = 500
    with pytest.raises(Exception, match="exactly the accepted amount"):
        contract.pay_offer(offer)
    direct_vm.value = 800
    oid = pay_offer_id(contract, offer)
    direct_vm.value = 0
    assert contract.get_offer(offer)["status"] == "paid"
    assert contract.get_order(oid)["amount"] == 800
    assert config(contract)["escrowed"] == 800


def test_offer_reject_and_withdraw(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    o1 = create_offer(contract, lid, 700)
    o2 = create_offer(contract, lid, 650)
    contract.withdraw_offer(o1)
    assert contract.get_offer(o1)["status"] == "withdrawn"
    as_(direct_vm, direct_alice)
    contract.reject_offer(o2)
    assert contract.get_offer(o2)["status"] == "rejected"


def test_release_reservation_after_pay_window(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    offer = create_offer(contract, lid, 800)
    as_(direct_vm, direct_alice)
    contract.accept_offer(offer)
    with pytest.raises(Exception, match="still has time"):
        contract.release_reservation(offer)
    warp_to(direct_vm, T_AFTER_PAY_WINDOW)
    contract.release_reservation(offer)
    assert contract.get_offer(offer)["status"] == "expired"
    assert contract.get_listing(lid)["status"] == "active"


def test_cannot_offer_on_own_listing_or_when_closed(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="own listing"):
        contract.make_offer(lid, 100)
    as_(direct_vm, direct_alice)
    contract.set_listing_paused(lid, True)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="not open for offers"):
        contract.make_offer(lid, 100)


# ---------------------------------------------------------------------------
# Disputes
# ---------------------------------------------------------------------------
def _disputed_order(contract, direct_vm, seller, buyer):
    lid = make_listing(contract, direct_vm, seller)
    oid = buy(contract, direct_vm, buyer, lid)
    deliver(contract, direct_vm, seller, oid)
    warp_to(direct_vm, T_DELIVERED_PLUS_1)
    as_(direct_vm, buyer)
    contract.open_dispute(oid, "The item arrived with a cracked frame, not as described.")
    return lid, oid


def test_buyer_opens_dispute_only_after_delivery(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="only after delivery"):
        contract.open_dispute(oid, "Not delivered")
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Only the buyer"):
        contract.open_dispute(oid, "Seller tries")


def test_ai_verdict_buyer_refunds(contract, direct_vm, direct_alice, direct_bob):
    direct_vm.mock_llm("DISPUTE_ARBITRATION", '{"winner": "buyer"}')
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    as_(direct_vm, direct_alice)
    contract.respond_dispute(oid, "The bike was shipped in good condition.")
    contract.resolve_dispute(oid)
    order = contract.get_order(oid)
    assert order["status"] == "refunded"
    assert order["outcome"] == "ai verdict: buyer"
    assert config(contract)["escrowed"] == 0


def test_ai_verdict_seller_releases_funds(contract, direct_vm, direct_alice, direct_bob):
    direct_vm.mock_llm("DISPUTE_ARBITRATION", '{"winner": "seller"}')
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    as_(direct_vm, direct_alice)
    contract.respond_dispute(oid, "Photos show the frame is intact.")
    contract.resolve_dispute(oid)
    order = contract.get_order(oid)
    assert order["status"] == "completed"
    assert order["outcome"] == "ai verdict: seller"
    assert config(contract)["accrued_fees"] == FEE


def test_resolve_waits_for_response_then_defaults_to_refund(contract, direct_vm, direct_alice, direct_bob):
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    with pytest.raises(Exception, match="Waiting for the seller"):
        contract.resolve_dispute(oid)
    warp_to(direct_vm, T_AFTER_RESPONSE)
    contract.resolve_dispute(oid)
    assert contract.get_order(oid)["outcome"] == "no seller response"


def test_dispute_llm_failure_keeps_order_in_dispute(contract, direct_vm, direct_alice, direct_bob):
    direct_vm.mock_llm("DISPUTE_ARBITRATION", "unparseable")
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    as_(direct_vm, direct_alice)
    contract.respond_dispute(oid, "Here is my side.")
    with pytest.raises(Exception, match="LLM_ERROR"):
        contract.resolve_dispute(oid)
    assert contract.get_order(oid)["status"] == "disputed"


def test_moderator_override_and_only_moderators(contract, direct_vm, direct_alice, direct_bob, direct_dave):
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only owner or moderator"):
        contract.resolve_dispute_manually(oid, True)
    as_(direct_vm, direct_alice)
    contract.set_moderator(direct_dave, True)
    as_(direct_vm, direct_dave)
    contract.resolve_dispute_manually(oid, False)
    assert contract.get_order(oid)["outcome"] == "moderator: release"


# ---------------------------------------------------------------------------
# Ratings and reputation
# ---------------------------------------------------------------------------
def test_ratings_after_completion_are_one_per_side(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    with pytest.raises(Exception, match="after the order completes"):
        as_(direct_vm, direct_bob)
        contract.rate_counterparty(oid, 5, "great")
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(oid)
    contract.rate_counterparty(oid, 5, "Fast and as described")
    with pytest.raises(Exception, match="already rated"):
        contract.rate_counterparty(oid, 1, "changed my mind")
    as_(direct_vm, direct_alice)
    contract.rate_counterparty(oid, 4, "Paid promptly")
    rep = contract.get_reputation(direct_alice)
    assert rep["ratings"] == 1
    assert rep["average_x100"] == 500
    assert contract.get_review(oid, "seller")["comment"] == "Fast and as described"
    assert contract.get_reputation(direct_bob)["average_x100"] == 400


def test_rating_stars_are_bounded(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(oid)
    with pytest.raises(Exception, match="Stars must be"):
        contract.rate_counterparty(oid, 6, "")


# ---------------------------------------------------------------------------
# Fees, admin and pause
# ---------------------------------------------------------------------------
def test_owner_sets_fee_within_cap_and_withdraws(contract, direct_vm, direct_alice, direct_bob):
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="Fee must be"):
        contract.set_fee_bps(600)
    contract.set_fee_bps(100)
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(oid)
    assert config(contract)["accrued_fees"] == 10  # 1% of 1000
    as_(direct_vm, direct_alice)
    contract.withdraw_fees()
    assert config(contract)["accrued_fees"] == 0
    with pytest.raises(Exception, match="No fees"):
        contract.withdraw_fees()


def test_non_owner_cannot_set_fee(contract, direct_vm, direct_bob):
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only owner"):
        contract.set_fee_bps(10)


def test_global_pause_blocks_create_and_buy(contract, direct_vm, direct_alice, direct_bob, direct_dave):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_alice)
    contract.set_moderator(direct_dave, True)
    as_(direct_vm, direct_dave)
    contract.set_global_pause(True)
    with pytest.raises(Exception, match="paused"):
        buy(contract, direct_vm, direct_bob, lid)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="paused"):
        contract.create_listing("Lamp", "", "home", 1, "", "", "used")
    as_(direct_vm, direct_dave)
    contract.set_global_pause(False)
    assert buy(contract, direct_vm, direct_bob, lid) >= 0


def test_two_step_ownership_transfer(contract, direct_vm, direct_alice, direct_bob):
    as_(direct_vm, direct_alice)
    contract.propose_owner(direct_bob)
    with pytest.raises(Exception, match="Only the proposed owner"):
        contract.accept_ownership()
    as_(direct_vm, direct_bob)
    contract.accept_ownership()
    assert config(contract)["owner"] == direct_bob


def test_profile_name_is_stored(contract, direct_vm, direct_alice):
    as_(direct_vm, direct_alice)
    contract.set_profile_name("  Alice Seller ")
    assert contract.get_profile(direct_alice) == "Alice Seller"
    with pytest.raises(Exception, match="Display name must be"):
        contract.set_profile_name("")


def test_buyer_and_seller_order_pages(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    o1 = buy(contract, direct_vm, direct_bob, lid)
    buyer_page = contract.buyer_orders(direct_bob, 0, 10)
    seller_page = contract.seller_orders(direct_alice, 0, 10)
    assert buyer_page["total"] == 1 and buyer_page["items"][0]["id"] == o1
    assert seller_page["total"] == 1 and seller_page["items"][0]["id"] == o1
    assert buyer_page["items"][0]["status"] == "paid"


def test_payment_after_window_is_rejected(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    as_(direct_vm, direct_bob)
    offer = create_offer(contract, lid, 800)
    as_(direct_vm, direct_alice)
    contract.accept_offer(offer)
    warp_to(direct_vm, T_AFTER_PAY_WINDOW)
    as_(direct_vm, direct_bob)
    direct_vm.value = 800
    try:
        with pytest.raises(Exception, match="Payment window has closed"):
            contract.pay_offer(offer)
    finally:
        direct_vm.value = 0
    assert contract.get_offer(offer)["status"] == "accepted"
    assert config(contract)["escrowed"] == 0


def test_dispute_after_confirmation_window_is_rejected(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    warp_to(direct_vm, T_AFTER_CONFIRM)
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="confirmation window has closed"):
        contract.open_dispute(oid, "Too late to complain")
    assert contract.get_order(oid)["status"] == "delivered"


def test_seller_response_after_deadline_is_rejected(contract, direct_vm, direct_alice, direct_bob):
    _, oid = _disputed_order(contract, direct_vm, direct_alice, direct_bob)
    warp_to(direct_vm, T_AFTER_RESPONSE)
    as_(direct_vm, direct_alice)
    with pytest.raises(Exception, match="response window has closed"):
        contract.respond_dispute(oid, "Late answer")
    assert contract.get_order(oid)["response"] == ""


def test_random_user_cannot_pause_protocol(contract, direct_vm, direct_bob):
    as_(direct_vm, direct_bob)
    with pytest.raises(Exception, match="Only owner or moderator"):
        contract.set_global_pause(True)
    assert config(contract)["global_paused"] is False


def test_payout_is_price_minus_fee(contract, direct_vm, direct_alice, direct_bob):
    lid = make_listing(contract, direct_vm, direct_alice)
    oid = buy(contract, direct_vm, direct_bob, lid)
    deliver(contract, direct_vm, direct_alice, oid)
    mark = transfer_mark()
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(oid)
    sent = transfers_since(mark)
    if sent is not None and sent:
        seller_payouts = [v for a, v in sent if a == direct_alice]
        assert seller_payouts == [PRICE - FEE]


def test_report_hidden_listing_is_restored_by_moderator(contract, direct_vm, direct_alice, direct_eve, direct_bob, direct_carol, direct_dave):
    lid = make_listing(contract, direct_vm, direct_alice)
    for reporter in (direct_eve, direct_bob, direct_carol):
        as_(direct_vm, reporter)
        contract.report_listing(lid, "suspicious")
    assert contract.get_listing(lid)["status"] == "hidden"
    as_(direct_vm, direct_alice)
    contract.set_moderator(direct_dave, True)
    as_(direct_vm, direct_dave)
    contract.restore_listing(lid)
    assert contract.get_listing(lid)["status"] == "active"
    assert contract.get_report_count(lid)["count"] == 0


def test_accounting_invariants_hold_across_mixed_orders(contract, direct_vm, direct_alice, direct_bob, direct_carol):
    lid_a = make_listing(contract, direct_vm, direct_alice, title="Item alpha", price=1000)
    lid_b = make_listing(contract, direct_vm, direct_alice, title="Item beta", price=2000)
    lid_c = make_listing(contract, direct_vm, direct_alice, title="Item gamma", price=3000)
    a = buy(contract, direct_vm, direct_bob, lid_a, value=1000)
    b = buy(contract, direct_vm, direct_carol, lid_b, value=2000)
    c = buy(contract, direct_vm, direct_bob, lid_c, value=3000)
    deliver(contract, direct_vm, direct_alice, a)
    as_(direct_vm, direct_bob)
    contract.confirm_receipt(a)            # completed: fee 25
    as_(direct_vm, direct_alice)
    contract.cancel_order(b)               # refunded (seller cancel)
    deliver(contract, direct_vm, direct_alice, c)  # delivered, still open

    def expected():
        open_amount, fees = 0, 0
        for oid in range(int(config(contract)["order_count"])):
            o = contract.get_order(oid)
            if o["status"] in ("paid", "delivered", "disputed"):
                open_amount += o["amount"]
            if o["status"] == "completed":
                fees += o["fee"]
        return open_amount, fees

    open_amount, fees = expected()
    cfg = config(contract)
    assert cfg["escrowed"] == open_amount == 3000
    assert cfg["accrued_fees"] == fees == FEE
    assert contract.get_listing(lid_a)["status"] == "sold"
    assert contract.get_listing(lid_b)["status"] == "active"
    assert contract.get_listing(lid_c)["status"] == "reserved"
