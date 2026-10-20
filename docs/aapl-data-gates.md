# AAPL data prerequisites

Research checked 2026-10-19. AAPL is not enabled or in the crypto allowlist.
No live stock feed, session calendar or trade integration has been implemented. stockPrerequisites is an inert server-side readiness check,
not an execution guard. Existing crypto behavior is unchanged.

## Massive selected, free-tier integration blocked

Lucas selected Massive (formerly Polygon.io). Official pages checked 2026-10-19.
Stocks Basic is free, 5 REST requests/minute, with end-of-day custom aggregates
and two years of history. Basic does not include minute-aggregate WebSockets.
Starter and Developer aggregates are 15-minute delayed; Advanced is real-time.
A free key cannot deliver fresh regular-session prices. Marketing headlines
about real-time data do not override the endpoint-specific plan tables.

https://massive.com/stocks
https://massive.com/docs/rest/stocks/aggregates/custom-bars
https://massive.com/docs/websocket/stocks/aggregates-per-minute

The Market Data Terms (updated August 28, 2025) grant personal, non-business,
non-commercial use. Absent prior express written consent from Massive or an
applicable Third Party Provider agreement, they prohibit displaying or
redistributing data AND derived charts/works to any third party. Individual
plans are not a friends-only redistribution license. Lucas accepts the
friends-only play-money use case, but that does not establish provider
permission. Massive's stocks FAQ directs redistribution/customer-facing
display to Business plans.

https://massive.com/legal/market-data-terms-of-service
https://massive.com/stocks

Prepare MASSIVE_API_KEY only in the server environment; never put it in
NEXT_PUBLIC variables, client requests, URLs, fixtures or logs. No key is
available to this worker and no live entitlement has been verified.
stockPrerequisites reads credential presence only and never returns its value.
The Basic end-of-day blocker is unconditional even when credentials and an
approval reference are supplied. No environment toggle enables AAPL.

No provider client, WebSocket, REST polling, historical download, signup or
purchase is added. Polling EOD data faster does not make it fresh. A licensed
fresh-data entitlement and parent-approved integration policy are blockers,
not assumptions to hide behind an implementation. Revisit plan verification
only with actual provider evidence; a claimed plan string is insufficient.
chub searches for Massive and Polygon found no applicable API documentation,
so official endpoint documentation was read directly.

## Accepted execution policy, not yet implemented

Use the existing spot/perp leverage rules, not new stock-specific leverage.
Reject every market execution, including manual close, outside the regular
session or on stale, halted, invalid, disconnected or unlicensed data. Retain
locked margin and pending TP/SL/liquidation checks while closed. Evaluate them
only on a fresh valid next-session tick, with gap risk, never a cached close.
Display the timestamped last regular-session price as last session price, not
a live executable price. Derive next open from a maintained exchange calendar,
not weekday arithmetic. Crypto stays 24/7.

A suitable calendar candidate is exchange_calendars, whose documented regular
sessions exclude pre/post market and handle holidays and special closes.
https://github.com/gerrymanoim/exchange_calendars
It has not been installed, version-pinned, audited or integrated here. Calendar
boundary/holiday/early-close/DST tests remain required before enabling stocks.

If licensed, use one server upstream connection protected by the existing
distributed leader lease, including reconnect/lease-expiry failclosed handling.
Clients receive only the app's cached websocket/API data. Missing or unavailable
source must not fall back to delayed data presented as realtime.

Live prices and position balances need a coordinated corporate-action policy.
A post-split quote cannot be compared to an unreconciled pre-split entry. Until
reconciliation and split/halt detection exist, fail closed; do not silently
rewrite entries, shares or balances.

## Firm live-only candle scope

Lucas removed backfilling completely. AAPL must never fetch past bars, call a
historical API, schedule historical jobs or download archives. Persist candles
collected from future live ticks to Mongo. Charts read only our stored Mongo
candles. Retain existing stored candles; do not clear or replace them. Empty
periods remain empty, with no synthetic historical fill. Historical aggregate capability was researched only to establish plan
entitlements; no aggregate requests are implemented or authorized.

This worker owns only docs/aapl-data-gates.md, lib/stock-config.ts and
tests/stock-config.test.ts. The backfill-removal worker owns candles/history
changes. Shared feed, store, types and market configuration require parent
coordination before stock integration. No production deployment.

## Remaining acceptance gates

Written redistribution permission and server-only credentials; provider protocol
fixtures and mock websocket tests; singleton/cache/reconnect/fencing tests;
maintained session calendar integration; stale/closed/holiday/early-close/DST
execution and persistent margin/trigger tests; corporate-action reconciliation;
chart/session UI integration and bundle/log secret checks; full compile and
combined regression suite. No deployment is authorized by this research.
