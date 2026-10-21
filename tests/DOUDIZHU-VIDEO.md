# Isolated video fixtures

Only the CLI may seed fixtures. No HTTP endpoint exists. The CLI requires exactly MONGODB_DB=fakebucks_demo_doudizhu and a loopback Mongo URI. It refuses any non-synthetic account. Each reset refunds existing demo escrow in the same conserved room CAS.

From the repository run:

```sh
MONGODB_URI=mongodb://127.0.0.1:38627 MONGODB_DB=fakebucks_demo_doudizhu npx tsx tests/doudizhu-video-fixture.ts bomb
```

The last argument selects bomb, rocket, airplane, spring, settlement, loss, reveal or deal. Capture the page before triggering the returned nextAction. Start the ordinary action within 60 seconds, otherwise the real timer acts.

bomb/rocket/airplane stage the matching cards in seat 0. Select the printed play cards and use ordinary Play. A spare card prevents premature settlement.

spring stages a final ace in landlord seat 0, farmers with no previous plays. Play the ace to trigger spring and a landlord win.

settlement stages the same final ace but a farmer has played, so the result is an ordinary landlord win.

loss stages a final ace in farmer seat 1, landlord with two prior plays. Play as Mochi (demo x-demo-seat 1) to trigger farmer win and landlord loss. Record seat 0 to show loser UI.

reveal stages bidding before landlord selection. Seat 0 bids 3 via the normal UI, revealing the kitty and expanding their hand to 20 cards.

deal stages all three joined, seats 0 and 1 ready, seat 2 unready. Ready Dango (demo x-demo-seat 2) through the ordinary API/UI to start the actual deal.

Every output includes nextAction, seat and current public view. The existing demo API accepts x-demo-seat 0, 1 or 2; all ordinary mutating requests require a fresh requestId, requestAt, and current version. No fixture/admin HTTP shortcut was added.

The exported seed helper permits isolated fakebucks_test_* databases only for integration tests. Never run the CLI against production or copy fixture state into production.
