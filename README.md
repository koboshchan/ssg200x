# ssg200x

A private, web-only play-money room. Google sign-in through Clerk, invitation-only sign-up, and one shared $1,000 starting bankroll. No deposits, withdrawals, real-money trades, or cash prizes.

## What’s included

Six-seat multiplayer no-limit hold’em. Players choose a seat and buy in with $100–$1,000 from their wallet. A hand starts only when every seated player has pressed Ready, with at least two players. Ready is one-way; a five-minute server deadline from the first Ready resets all readiness if everyone is not ready in time. Each hand requires fresh readiness. Heads-up is $1/$2; three or more players add a live $5 UTG straddle. Server-shuffled cards, side pots, split pots, short all-ins, turn timeouts, and atomic cashouts are handled server-side. Players can return their stack to their wallet while not ready and outside an active hand, including after showdown settles. A single authenticated, WebSocket-only Socket.IO connection pushes private room snapshots, market prices and positions, game state, balances, maintenance and administrator history progress. Each player receives only their own hole cards and portfolio; administrators receive their authorized account controls. HTTP is used for initial loading, chart selection and actions, never periodic live-data polling. Reconnects use fresh Clerk tokens and force a new private snapshot. Connected seats are kept alive server-side without client polling.

European single-zero roulette supports straight, red/black, odd/even, low/high, dozen, and column bets. Everyone shares a 60-second round with betting open for 55 seconds and locked for the last five. Each spin is generated with Node’s cryptographic RNG. Bets clear after settlement; Last bet repeats the prior round only while betting is open and sufficient funds are available. Gross returns include the stake: 36× straight, 3× dozen/column, 2× outside. $1 minimum per bet, $1,000 maximum total stake, up to 20 bets per spin.

The selected twenty crypto symbols’ spot paper trading uses Coinbase’s public USD spot prices. TradingView Lightweight Charts renders cached Coinbase USD candles, without a third-party price iframe. Fractional holdings and open positions count toward net-worth standings.

Isolated simulated perpetuals offer 1×–200× leverage, long or short. Choose margin, open at the current server reference, and close at market. No fees, slippage, funding, or exchange order book simulation. Global maintenance margin defaults to 0%. Administrators can cap spot order value and perpetual margin/notional per position with a global trade limit (default $1,000,000) and cap new-position leverage (default 200×). Lowering a limit does not resize existing positions. The initial margin ratio must exceed maintenance margin.

An administrator can add or remove cash, edit any open position’s liquidation threshold, and change global maintenance margin. Every change records the administrator, operation, target, previous value, new value, and timestamp in MongoDB’s audit collection. Cash adjustments do not inflate profit standings.

## Clerk setup

Create a Clerk application with Google as its only sign-in/sign-up method. Disable passwords, email-code sign-in, and other social providers. The backend checks for a verified primary email, a linked Google account, and password-disabled accounts, not merely a client-side Google button.

Copy .env.example to .env.local and supply your development Clerk keys for local work. Never commit that file. The publishable key is embedded at build time, so changing it requires a rebuild.

For local development set APP_ORIGIN=http://localhost:43891 and APP_PORT=43891. In the Clerk dashboard, add that origin where appropriate for your instance and configure the production domain before publishing a production deployment.

After the host signs in once, open that user in Clerk’s dashboard and set Public metadata to:

```json
{"role":"admin"}
```

Admin authorization reads currentUser().publicMetadata on the server. ADMIN_EMAILS is not used. No role can be supplied in an API request. Session-token customization is optional because this app does not trust cached client claims; if another frontend needs the metadata, the Clerk session token customization is:

```json
{"publicMetadata":"{{user.public_metadata}}"}
```

For production, set Clerk sign-up mode to Restricted (invitation-only), leaving Google as the only provider. Manage invitations directly in the Clerk dashboard. The app has no invitation form or invitation endpoint. Clerk Restricted mode is the only account-access gate; authenticated accounts can play immediately. There is no second in-app approval step. Use a production Clerk instance for a lasting public deployment. Development instances display Clerk’s development notice.

## Running

With Docker and Compose installed:

```sh
cp .env.example .env.local
# Fill in the keys and exact origin.
docker compose --env-file .env.local -f compose.yaml -f compose.dev.yaml up -d
```

The local development web server is bound only to 127.0.0.1 and APP_PORT. No public deployment or tunnel is needed. MongoDB has no published port and joins only an internal Compose network. The application reaches it by the service hostname mongo. The ./data/mongo bind mount contains wallets, room state, and audit history and is gitignored. Back it up and restrict access to the Docker host.

For local development, point MONGODB_URI at your own Mongo instance, set MONGODB_DB, and run npm run dev. Standard production builds use npm run build and npm start. The prebuilt Dockerfile and compose.qa.yaml exist for local verification using an already-built standalone Next output; the regular compose file performs its own clean dependency/build stage.

## Verification

```sh
npm test
npm run typecheck
npm run build
MONGODB_URI=mongodb://your-test-mongo:27017 MONGODB_DB=fakebucks_test_store npm run test:integration
```

Integration tests refuse a database without the fakebucks_test_ prefix, create synthetic users, test concurrent updates and authorization rules, and drop only that explicitly named test database afterward.

The production implementation has no test authentication bypass. Never add one to simplify screenshots.

## Simulation limits

The server requests one batched Coinbase USD exchange-rate response per second when no perpetual is open, or up to five per second while a perpetual is open. A Mongo-backed lease caps aggregate requests across application processes. Orders and browsers only read the cache; requests never cause extra Coinbase fetches. Market orders execute immediately and do not remain open. Coinbase HTTP 429 responses back off rather than exceeding the budget. Orders fail closed if a quote is unavailable or more than ten seconds old. Liquidations use the shared cached prices and are checked only when the worker updates the cache. Outages and price gaps can therefore skip an intragap liquidation; this is not a real exchange or a continuous matching engine.

Long liquidation is entry × (1 − 1/leverage) / (1 − maintenance). Short liquidation is entry × (1 + 1/leverage) / (1 + maintenance). An administrator’s explicit threshold overrides that formula for the selected position. Maintenance changes update existing formula-based positions. Setting a threshold across the current price can immediately liquidate the position. Liquidation consumes the entire isolated margin and never the rest of the wallet.

Quotes and charts can differ. Unrealized standings use the last available quote and can be stale during an outage. No historical price replay or financial accuracy guarantee is provided.

All bankroll writes use optimistic compare-and-swap against one Mongo room document, which also keeps poker chips and financial holdings atomic with cash. Request IDs with short expiry prevent duplicate financial actions; Mongo-backed counters rate-limit requests. Private cards, decks, internal user IDs, other users’ portfolio details, and admin-only emails are never sent in ordinary player snapshots.

This small-group design is intended for a small group, not an unbounded public casino. Administrator audit events first enter the same atomic room update, then are idempotently copied to the audit collection. Pending events remain durable and retry on subsequent updates after an audit-write outage. Administrators with direct database access can change the data; the audit is not a tamperproof external ledger.

Three multiplayer blackjack tables share the bankroll. Each has six selectable seats, a ten-second betting countdown, thirty-second turns, hit, stand, double and one split. Six-deck shoes use unbiased Fisher–Yates with OS cryptographic entropy. The dealer stands on soft 17, naturals pay 3:2, split aces receive one card, and split hands do not receive natural payouts. Dealer hole cards and the remaining shoe never enter client snapshots.

Historical candles are persistently cached in Mongo. At first boot, the last twelve complete monthly Binance USDT 1-minute archives and Coinbase USD 1-minute pages for the current month are queued for all twenty symbols. They are aggregated locally into 1m, 5m, 15m, 1h, 6h and 1d candles. USDT archive references are identified as such; they are not USD trades. Coinbase USD supplies current-month history, live prices and incremental updates afterward. Any Coinbase historical request has at most 300 buckets. A shared historical request budget reserves live-polling capacity and stays below ten combined requests per second. Completed history resumes without restarting, missing products are marked unavailable, and later jobs top up the cache. During backfill, signed-in non-administrators see an Under maintenance page and cannot access game or trading APIs. Administrators bypass it, see overall and per-symbol monthly/daily progress, source and an observed-throughput ETA, and can toggle an independently audited manual maintenance switch. Automatic maintenance lifts when every monthly archive and current-month Coinbase job finishes or is explicitly marked unavailable. Manual maintenance remains enabled until switched off. Administrators can inspect per-symbol progress and ETA; unavailable capacity pauses imports with an explicit status. At least 2 GiB free space is required before historical downloads. A low-space pause is not a completed backfill.
