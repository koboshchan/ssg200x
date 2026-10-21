AAPL, TSLA, NVDA, MSFT, AMD and SPCX integration preparation, checked 2026-10-19.

Alpaca replaces Massive. Basic includes realtime IEX stock data and up to 30 subscribed symbols. IEX is a single venue, not consolidated NBBO or all-market volume. Use only wss://stream.data.alpaca.markets/v2/iex. No delayed SIP fallback. Keys are server-only ALPACA_KEY_ID and ALPACA_SECRET; never NEXT_PUBLIC variables, client requests, URLs or logs. This change makes no provider request and does not enable any equity.

https://docs.alpaca.markets/us/docs/about-market-data-api
https://docs.alpaca.markets/us/v1.4.2/docs/real-time-stock-pricing-data
https://docs.alpaca.markets/us/v1.4.2/docs/streaming-market-data

The injectable AlpacaIexFeed authenticates on socket open, then subscribes to AAPL, TSLA, NVDA, MSFT, AMD and SPCX trades and quotes in one pooled upstream connection after authenticated acknowledgement. Arrays are decoded with size limits. Subscription acknowledgement is required before ticks. Only finite positive regular-sale prints with fresh, strictly increasing timestamps are emitted. Unknown trade conditions are conservatively excluded. Quotes and bars are not executable last-trade prices. Minute bars describe the previous minute, include extended hours and may be revised by updatedBars; no bars are subscribed or used to fabricate historical candles. Automatic correction/cancel messages, or a configured equity status message, disconnect this conservative prepared adapter rather than silently retaining questionable execution data. Reconciliation can be implemented later.

Alpaca requires authentication within 10 seconds. The adapter's 8-second handshake watchdog closes missing auth/subscription acknowledgements. Authentication, entitlement, invalid subscription and symbol-limit errors stop automatic retries. Transport errors, slow-client/connection-limit/server errors remain retryable through retryDelay, a bounded 1–30 second exponential backoff. Runtime must schedule those retries with jitter, stop the feed immediately on distributed lease loss, and invalidate executable cached prices on every non-subscribed state. Do not create a socket per viewer. Most subscriptions permit only one upstream connection to an endpoint; another app using the same account can exhaust that limit. This isolated module starts no timers or network at import/construction.

Shared runtime integration is intentionally not implemented in this commit. Construct one feed only inside the existing distributed leader lease and pass isLeader/permitted callbacks. Fence downstream Mongo writes and app websocket broadcasts with that same lease revision, not only an in-memory flag. Stopping detaches/fences old socket callbacks. A runtime retry/supervision loop, singleton failover tests, clock/calendar fetch/cache and actual entitlement checks remain before enabling. Never send credentials, upstream frames or raw error messages to clients.

Session parsing consumes Alpaca Trading API calendar rows with date/open/close in America/New_York, and Trading API clock responses. IANA timezone conversion handles DST; actual provider rows, not weekday arithmetic, define holidays and early closes. Clock receipt/provider timestamps expire after 60 seconds, closed clocks and calendar/clock close-time disagreements fail closed. Use the regular open/close fields, never extended session_open/session_close.

For an authorized paper-account runtime, the documented server endpoints are GET https://paper-api.alpaca.markets/v2/calendar and GET https://paper-api.alpaca.markets/v2/clock with APCA-API-KEY-ID and APCA-API-SECRET-KEY headers. Calendar start/end query parameters should request today and upcoming sessions only. Calendar metadata is not a historical price backfill. These legacy Trading API endpoints remain documented; newer v3 multi-market endpoints have different response shapes and must not be fed to these parsers. Broker API /v1/calendar uses different credentials and is not the chosen endpoint. No calendar/clock HTTP client or provider request is activated in this preparation.

https://docs.alpaca.markets/us/reference/legacycalendar
https://docs.alpaca.markets/us/reference/legacyclock
https://docs.alpaca.markets/us/v1.4.2/reference/getcalendar-1
https://docs.alpaca.markets/us/v1.4.2/reference/getclock-1

stockExecutionPolicy is a pure shared-guard candidate for every stock execution including open, manual close, TP/SL and liquidation. It requires authorized feed, connected lease leader, positively cleared halt state, reconciled corporate actions, verified regular session and a positive matching-symbol IEX tick received and timestamped within 15 seconds of now and within this session. Future, previous-session, unknown-halt and stale prices are not executable. It never mutates positions, margin or pending triggers. Shared finance hooks must preserve those records while blocked and reevaluate on a fresh next-session print with gap risk. Use existing spot/perp leverage rules, not invented stock limits. Actual halt-status entitlement/bootstrap and corporate-action reconciliation are still unresolved, so no code should assume clear by default.

Charts must consume only future live collected ticks persisted to Mongo. No historical bars, archives, jobs, REST latest-price polling, candle replacement or synthetic gaps are introduced. Retain existing Mongo candles. Clients use the app's cached websocket/API snapshots, never an upstream provider connection. Existing crypto stays 24/7; the six equities remain outside its allowlist until coordinated shared integration.

Lucas accepts friends-only play-money use. That is not evidence of an Alpaca redistribution license. Alpaca's support page says API data cannot be redistributed and its terms restrict distribution without prior express written consent. Existing AAPL_REDISTRIBUTION_APPROVAL_REFERENCE remains a reference to actual permission, not a new boolean opt-in or a claim that the app has permission. No new approval flag was invented. Parent policy is required before changing this gate.

https://alpaca.markets/support/redistribute-alpaca-api
https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf

Credential-free fixture tests cover auth/subscription ordering, framing, symbol/condition/stale filters, reconnect delay, terminal entitlement failures, leadership/permission revocation, callback fencing, provider calendar DST/early close validation and execution failclosed behavior. They do not prove live connectivity, account entitlement, halt coverage, redistribution permission, shared hook behavior, actual margin persistence, UI behavior or production readiness. No deploy, account signup/settings, trade order or paid request is authorized here.

chub search alpaca returned no matching documentation entry, so official protocol and API references above were used directly. No package/dependency installation was needed.

The exact equity allowlist is AAPL, TSLA, NVDA, MSFT, AMD and SPCX. Deduplication timestamps are per symbol, so simultaneous prints for different stocks are independent. All six must appear in the pooled trades/quotes subscription acknowledgement. Reconnect resubscribes the same pool on one replacement connection, never a socket per symbol. Execution state names its target symbol and rejects a tick from another symbol. A key file existing on disk is not evidence of live authentication or entitlement; no credentials were read or used for this preparation. The legacy AAPL_REDISTRIBUTION_APPROVAL_REFERENCE name is preserved rather than inventing a new flag; its scope and actual permission still require runtime policy review.

Isolated live verification on 2026-10-19 used scripts/stock-dev-check.cjs in a disposable KAT-BOX dev container. Credentials were injected through private stdin into that process's runtime environment, not copied into source, a build context, logs or command arguments. The actual provider clock reported is_open=false at 2026-10-19T22:40:54.957911834-04:00, with next_open 2026-10-20T09:30:00-04:00. Exactly one IEX websocket authenticated and acknowledged the complete AAPL/TSLA/NVDA/MSFT/AMD trades/quotes pool. No fresh trades or quotes arrived during the 12-second observation; live regular-session ticks are NOT verified. This confirms authentication/subscription, not live execution readiness or shared app integration. Rerun during a regular session before claiming six-symbol live tick coverage. The harness creates no historical requests, provider orders or app state changes.

Production configuration needs ALPACA_KEY_ID and ALPACA_SECRET in the server runtime only. Key presence never overrides session/execution policy or proves provider availability. This test did not modify or restart any existing dev/prod/pinned-QA application; production deployment remains unauthorized.

SPCX was added only after identity and IEX support verification. Nasdaq's official listing identifies Space Exploration Technologies Corp. Class A Common Stock, https://www.nasdaq.com/market-activity/stocks/spcx . Credentialed Alpaca GET /v2/assets/SPCX returned HTTP 200, the same issuer name, us_equity, NASDAQ, active and tradable=true. One IEX websocket authenticated and acknowledged trades and quotes for all six configured symbols, including SPCX, at provider clock 2026-10-19T22:43:06.59209932-04:00 with is_open=false. No events arrived in 12 seconds. GET /v2/stocks/SPCX/trades/latest?feed=iex returned HTTP 200, symbol SPCX, price 148.69, timestamp 2026-10-19T20:37:45.929009733Z, exchange V, conditions @ and T. This is stale extended-hours evidence of IEX coverage, not an executable fresh regular-session price. No latest-trade polling is integrated into the app. The prepared adapter allowlist now contains six equities; actual app runtime wiring and regular-session execution tests remain pending shared-file coordination.

The incidental wallet-nav change included in earlier commit 07a9e86 was reviewed and confirmed correct by its owning payment worker. It is preserved without rewriting history.

Six configured and subscription-acknowledged instruments does not mean six fresh executable marks. SPCX has exactly the same execution rules as the other five. Closed-hours stale or incomplete quotes never remove an instrument from the configured pool. The exact observed SPCX quote (timestamp 2026-10-19T20:00:02.387842451Z, bid 141.74, ask 0, bid exchange V, blank ask exchange) is a regression fixture: it emits no executable tick and does not disconnect or delist SPCX. Crossed quotes, missing exchanges and even valid quotes cannot become executable marks through this trade-only adapter. Future quote-based execution would need explicit fresh regular-session, positive noncrossed two-sided quote validation before use, not reinterpretation as trade events.

## Integrated source and remaining execution evidence (2026-10-19)

The six-equity runtime, trading union, API/UI/status transport, chart selector,
existing-lease publication transaction and financial guards are implemented.
Coinbase SYMBOLS remains exactly BTC/ETH/BNB/XRP/SOL/LTC. The chart selector does
not imply stock candle ingestion is finished. lib/candles.ts remains outside this
change until its backfill owner releases the committed file.

Alpaca's official real-time stock documentation describes a distinct statuses
subscription and T=s events, with symbol, timestamp, tape, status code and reason.
UTP H/P mean halt/pause, Q is quotation resumption (not trading resumption), and T
is trading resumption. CTA 2/3 mean halt/resume. Reasons include corporate actions
(N for CTA, M1 for UTP). The documentation says availability depends on subscription;
it does not establish this account's IEX status entitlement, an initial status
snapshot, replay after disconnect, or proof that silence means no halt.
Trade/quote acknowledgments therefore do not establish usable status coverage.
A fresh regular trade, including condition @, must never clear unknown status.

Source: https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data

The current corporate actions endpoint is GET
https://data.alpaca.markets/v1/corporate-actions. Its data_quality=all option includes
early/incomplete records; the default complete filter can omit them. Responses
are paginated across all symbols, not per symbol. The documentation explicitly
warns that ingestion/processing can be delayed and gives no creation-time
guarantee. An empty successful response is not proof that no action exists.
Merely receiving a resume event also cannot reconcile an outstanding split,
merger, name change, or preserved account claim. No reconciliation state is
automatically cleared from trade arrival or a successful HTTP response.

Source: https://docs.alpaca.markets/us/reference/corporateactions-1

Consequently instrument halt and corporate-action reconciliation remain unknown
in the runtime until authoritative per-symbol evidence and reconciliation are
actually integrated and tested. UI discovery, subscription acknowledgment and
guard fixtures are not a claim that live stock orders are usable. The current
implementation deliberately retains positions, margin and triggers while blocked.

The parent coordinates one final frozen current-source build after stock and
chat sources stabilize. No second Next build or production deployment is part of
this work. Focused compilation and 112 tests passed; the real isolated Mongo
replica-set publication test also passed. These are not a substitute for that
final combined build or authenticated browser QA.

SPY joins the same pooled IEX stock pipeline as the six configured company stocks. It is the S&P 500 tracking ETF, displayed as "S&P 500 (SPY)", not a directly streamed index. It uses the same regular-session calendar, fresh-trade execution guards, server-built candles and chart allowlist. No new connection, historical polling or extended-hours trading is introduced. SPY identity reference: https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy .
