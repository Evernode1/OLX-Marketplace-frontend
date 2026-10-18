# Integration tests (studionet)

These tests use real GenLayer consensus and real value transfers. They are not run by the offline runner.

Run:

    gltest --network studionet tests/integration -v

Requirements:

- The accounts gltest provides for studionet must hold enough GEN to cover the test amounts
  (0.001 GEN per listing, plus gas). Fund them before running. Studionet is gasless for transactions,
  but a value transfer still needs a funded sender.
- `accounts[1]` is the seller, `accounts[2]` is the buyer, and `default_account` is the contract owner
  and fee recipient. Each test deploys a fresh contract.
- Each listing runs the AI policy check on-chain, so each test takes minutes, not milliseconds.

Not covered here: the dispute refund and the dispute release, which depend on an LLM verdict through
`resolve_dispute`. Those need a separate run with mocked validators or a live check.
