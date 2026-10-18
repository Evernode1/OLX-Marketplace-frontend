"""SDK-backed value-flow tests. These run on a real GenLayer network through gltest Studio mode.

They cover inbound payable purchases, the buyer refund, seller release, and fee withdrawal.
Balances are read from the contract itself (`get_contract_balance`, `escrow_check`), and the
transfers are read from the transaction messages, which the network records for each
`emit_transfer` call. There are no offline shims and no skipped assertions.

Run with:  gltest --network studionet tests/integration
"""

from gltest import get_contract_factory
from gltest.assertions import tx_execution_failed, tx_execution_succeeded

LISTING_PRICE = 1_000_000_000_000_000  # 0.001 GEN, in wei
FEE_BPS = 250  # the contract default (2.5%)
FEE = LISTING_PRICE * FEE_BPS // 10000
SELLER_PAYOUT = LISTING_PRICE - FEE


def _addr(account) -> str:
    return str(account.address).lower()


def _transfers(gl_client, receipt) -> list:
    """Transfers the contract emitted in this transaction, as (recipient, value) pairs."""
    tx_hash = receipt.get("hash") or receipt.get("transaction_hash")
    tx = gl_client.get_transaction(transaction_hash=tx_hash)
    out = []
    for msg in tx.get("messages", []):
        value = int(msg.get("value", 0))
        if value > 0:
            out.append((str(msg["recipient"]).lower(), value))
    return out


def _deploy(default_account):
    factory = get_contract_factory("Marketplace")
    return factory.deploy(account=default_account)


def _new_listing(contract, seller) -> int:
    receipt = contract.create_listing(
        args=["Used bicycle", "Good condition", "vehicles", LISTING_PRICE, "Lagos", "", "used"]
    ).transact(account=seller)
    assert tx_execution_succeeded(receipt)
    return int(contract.get_config().call()["listing_count"]) - 1


def _order_id(contract) -> int:
    return int(contract.get_config().call()["order_count"]) - 1


def test_inbound_payable_purchase_is_escrowed(default_account, accounts, gl_client):
    seller, buyer = accounts[1], accounts[2]
    contract = _deploy(default_account)
    listing_id = _new_listing(contract, seller)

    receipt = contract.buy_now(args=[listing_id]).transact(account=buyer, value=LISTING_PRICE)
    assert tx_execution_succeeded(receipt)

    assert contract.get_contract_balance().call()["balance"] == LISTING_PRICE
    check = contract.escrow_check().call()
    assert check["matches"] is True
    assert check["expected"] == LISTING_PRICE
    order = contract.get_order(args=[_order_id(contract)]).call()
    assert order["status"] == "paid"
    assert order["amount"] == LISTING_PRICE


def test_underpayment_is_rejected_and_nothing_is_escrowed(default_account, accounts):
    seller, buyer = accounts[1], accounts[2]
    contract = _deploy(default_account)
    listing_id = _new_listing(contract, seller)

    receipt = contract.buy_now(args=[listing_id]).transact(account=buyer, value=LISTING_PRICE - 1)
    assert tx_execution_failed(receipt)
    assert contract.get_contract_balance().call()["balance"] == 0
    assert contract.get_listing(args=[listing_id]).call()["status"] == "active"


def test_buyer_refund_when_seller_cancels_unfulfilled_order(default_account, accounts, gl_client):
    seller, buyer = accounts[1], accounts[2]
    contract = _deploy(default_account)
    listing_id = _new_listing(contract, seller)
    contract.buy_now(args=[listing_id]).transact(account=buyer, value=LISTING_PRICE)
    order_id = _order_id(contract)

    receipt = contract.cancel_order(args=[order_id]).transact(account=seller)
    assert tx_execution_succeeded(receipt)

    assert contract.get_order(args=[order_id]).call()["status"] == "refunded"
    assert contract.get_contract_balance().call()["balance"] == 0
    assert contract.escrow_check().call()["matches"] is True
    # The refund leaves the contract as one transfer of the full amount to the buyer.
    assert (_addr(buyer), LISTING_PRICE) in _transfers(gl_client, receipt)
    assert contract.get_listing(args=[listing_id]).call()["status"] == "active"


def test_seller_release_then_owner_fee_withdrawal(default_account, accounts, gl_client):
    seller, buyer = accounts[1], accounts[2]
    contract = _deploy(default_account)
    listing_id = _new_listing(contract, seller)
    contract.buy_now(args=[listing_id]).transact(account=buyer, value=LISTING_PRICE)
    order_id = _order_id(contract)
    contract.mark_delivered(args=[order_id]).transact(account=seller)

    release = contract.confirm_receipt(args=[order_id]).transact(account=buyer)
    assert tx_execution_succeeded(release)
    # The seller is paid the price minus the fee, and the fee stays in the contract.
    assert (_addr(seller), SELLER_PAYOUT) in _transfers(gl_client, release)
    assert contract.get_order(args=[order_id]).call()["status"] == "completed"
    assert contract.get_contract_balance().call()["balance"] == FEE
    assert contract.get_config().call()["accrued_fees"] == FEE
    assert contract.escrow_check().call()["matches"] is True

    withdraw = contract.withdraw_fees().transact(account=default_account)
    assert tx_execution_succeeded(withdraw)
    assert (_addr(default_account), FEE) in _transfers(gl_client, withdraw)
    assert contract.get_contract_balance().call()["balance"] == 0
    assert contract.get_config().call()["accrued_fees"] == 0
    assert contract.escrow_check().call()["matches"] is True
