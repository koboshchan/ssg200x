# Leaderboard trading performance

The authenticated GET /api/leaderboard/[publicId]/performance endpoint returns
`{asOf, periods: [{period, pnl, percent, reason?}]}`. Periods are 1h, 24h,
7d and 30d. PnL is signed integer cents; percent is a numeric percentage,
not a ratio. asOf is the current server valuation timestamp in milliseconds.
There are no wallet, private user ID, holding or position fields in this response.
A verified active Clerk session and the leaderboard feature gate apply. Signed-in viewers can read any visible public leaderboard profile, not just their own; and hidden/nonexistent users return the
same 404. Responses are no-store. Leaderboard rows expose their publicId.

Performance is the difference between current and baseline cumulative realized
spot PnL plus closed-perp realized PnL plus spot market value minus cost plus
open-perp fee-net unrealized PnL. All three spot sale paths (ordinary partial/full,
exact sell-all, legacy redemption) update the new cumulative counter in the
existing room transaction. Existing precollection spot history is not fabricated.
Its unknown constant offset cancels only between genuine prospective snapshots.
Existing closed perpetual history is retained by the application.

Percentage divides period PnL by baseline invested trading capital: spot cost
plus posted perpetual margin (and separately wallet-paid legacy opening fees).
It never divides by wallet balance or net worth. It is not time-weighted or
annualized. Zero baseline invested capital yields a valid absolute PnL but null
percent with zero_baseline_capital. Cashflows, games, predictions and airdrops
are absent from this metric.

A background worker reads the raw room without triggering settlement or any
room migration or mutation, initially and every 60 seconds. Its separate
tradingPerformanceSnapshots collection has immutable unique user/minute samples
and a 32-day TTL. Multiple app workers cannot overwrite a minute's first sample.
GET does not create collections, indexes or samples. The worker never runs in
the production build phase.

For each period the latest sample at/before the exact boundary must be within
two minutes. Missing baselines return null PnL/percent and baseline_unavailable;
snapshot intervals over two minutes return snapshot_gap. Invalid or missing
marks return valuation_unavailable, never a cost-basis price fallback. All
samples from the baseline through now must have valid valuations. Consequently
new deployment cannot display historical periods until enough real collection
history exists. Closed/stale market valuation may also leave periods unavailable;
no historical mark or gap is synthesized.
