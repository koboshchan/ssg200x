# Feature switches

`/players` has the administrator feature panel. Flags are persisted in MongoDB's
`featureFlags` collection, document `global`. Changes atomically append the actor,
time and requested patch to the same document's audit array and increment its
revision. Flags default on, except **stocks and forex default off**. Existing
installations without a flag document also use those safe defaults.

`SSG_FEATURES_FORCE_OFF=stocks,forex` forces named features off regardless of admin
settings. The public settings endpoint returns effective and configured values,
revision, and forced-off names. No credentials are exposed.

HTTP entry mutations and socket posting are checked server-side, including admins.
The runtime reads flags before starting provider connections and polls changes
approximately twice per second. Browsers poll every 15 seconds and on focus.
Crypto price connections are shared by spot and perpetuals, and stop when both are
off. Disabled stock and forex feeds do not open their provider connections.
Existing candles and portfolio records are not deleted.

## Existing claims

Disabling blocks new bets, joining/readying tables, starting mini-games, market
opens/buys/increases, payment sending, and disabled social posting. Already-funded
hands can finish; leaving, cancelling roulette bets, mini-game steps/cashout,
market sells/closes, and portfolio/history reads remain available. Existing
advancement records remain; no new advancement reward is issued while disabled.

A disabled market's provider is disconnected. Exits still require the ordinary
fresh, executable price and ownership checks. **No stale-price fill or forced
liquidation is introduced.** Once the last quote becomes ineligible, users retain
their claims but must wait until the market is re-enabled and healthy to sell or
close. This also applies to prediction-market sell quotes. Prediction resolution
polling remains active for existing positions so confirmed real outcomes can
settle normally. Admins should close positions while feeds are healthy before
switching a market off if immediate exit availability is required.

Navigation remains available for claim-bearing sections so users can find existing
positions and cashout controls; disabled sections show a temporary-disabled banner
and new-entry controls are disabled. Leaderboard/advancement discovery is hidden.

## FX universe

The administrator stages the complete pair list and saves once with
`PUT /api/admin/forex`. A single metadata request validates all pairs; one room CAS
checks list revision, preserves open claims, replaces the complete universe,
increments revision, and records the before/after audit. Removing a pair with
open holdings/positions is rejected. No partial empty list is published between
remove/add edits. The OANDA stream lifecycle debounces reconfiguration and awaits
cleanup of the old stream before opening another generation.
