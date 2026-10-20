# AAPL data prerequisites

Research checked 2026-10-19. AAPL is not enabled or in the crypto allowlist.
No live stock feed, session calendar, historical loader or trade integration has
been implemented. stockPrerequisites is an inert server-side readiness check,
not an execution guard. Existing crypto behavior is unchanged.

## Provider decision is blocked

Alpaca's official FAQ says the free websocket feed is IEX only, a single venue,
not consolidated SIP or NBBO. Specify IEX explicitly rather than letting an
account upgrade silently change source. Historical endpoints can explicitly
select IEX too. Free SIP historical queries must end at least 15 minutes ago;
that is not a realtime feed.
https://docs.alpaca.markets/us/docs/market-data-faq

The current documentation footer links these terms. They restrict content to
personal noncommercial use, require 30 days notice for an application offered
to others, and prohibit redistribution without express prior written consent.
Authenticated players still receive redistributed data. A free API key alone
does not establish permission.
https://s3.amazonaws.com/files.alpaca.markets/disclosures/library/TermsAndConditions.pdf

Finnhub free pricing says Personal Use, lists websocket access but not OHLC
history. Its terms prohibit redistributing data or derived results without
written approval. Enterprise pricing explicitly includes redistribution rights.
https://finnhub.io/pricing
https://finnhub.io/terms-of-service
https://finnhub.io/pricing-startups-and-enterprise

No plausible Alpaca/Finnhub/stock/market/Polygon credential filenames were found
under the connected secrets directory. No credentials, signup, purchases or
external feed connections were created. chub searches for both providers had no
entries; official provider documentation was used instead.

## Proposed execution policy, requires parent approval

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

Historical raw versus adjusted prices and position balances need a coordinated
corporate-action policy. Raw latest quotes cannot be compared to differently
adjusted entries after a split. Until reconciliation and split/halt detection
exist, fail closed; do not silently rewrite entries, shares or balances.
Historical candle loading scope also needs confirmation because the latest
request removed backfilling entirely. Do not start a stock backfill.

## Remaining acceptance gates

Written redistribution permission and server-only credentials; provider protocol
fixtures and mock websocket tests; singleton/cache/reconnect/fencing tests;
maintained session calendar integration; stale/closed/holiday/early-close/DST
execution and persistent margin/trigger tests; corporate-action reconciliation;
chart/session UI integration and bundle/log secret checks; full compile and
combined regression suite. No deployment is authorized by this research.
