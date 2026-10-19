# Fakebucks

A private, web-only play-money room. Google sign-in through Clerk, host-approved accounts, and one shared $1,000 starting bankroll. No deposits, withdrawals, real-money trades, or cash prizes.

## What’s included

Six-seat multiplayer no-limit hold’em. Players choose a seat and buy in with $100–$1,000 from their wallet. Two players starts a hand automatically. Heads-up is $1/$2; three or more players add a live $5 UTG straddle. Server-shuffled cards, side pots, split pots, short all-ins, turn timeouts, and deferred cashouts are handled server-side. The room refreshes every two seconds, not through WebSockets.

European single-zero roulette supports straight, red/black, odd/even, low/high, dozen, and column bets. Each spin is generated with Node’s cryptographic RNG. Gross returns include the stake: 36× straight, 3× dozen/column, 2× outside. $1 minimum per bet, $1,000 maximum total stake, up to 20 bets per spin.

BTC, ETH, SOL, and DOGE spot paper trading uses Coinbase’s public USD spot prices. TradingView supplies embedded charts separately. Fractional holdings and open positions count toward net-worth standings.

Isolated simulated perpetuals offer 1×–50× leverage, long or short. Choose margin, open at the current server reference, and close at market. No fees, slippage, funding, or exchange order book simulation. Global maintenance margin defaults to 0%. The initial margin ratio must exceed maintenance margin.

An administrator can approve or deny access, add or remove cash, edit any open position’s liquidation threshold, and change global maintenance margin. Every change records the administrator, operation, target, previous value, new value, and timestamp in MongoDB’s audit collection. Cash adjustments do not inflate profit standings.

## Clerk setup

Create a Clerk application with Google as its only sign-in/sign-up method. Disable passwords, email-code sign-in, and other social providers. The backend checks for a verified primary email, a linked Google account, and password-disabled accounts, not merely a client-side Google button.

Copy .env.example to .env.local and supply your development or production Clerk keys. Never commit that file. The publishable key is embedded at build time, so changing it requires a rebuild.

Set APP_ORIGIN to the exact public HTTPS origin, without a path, and APP_PORT to an unused local port. In the Clerk dashboard, add that origin where appropriate for your instance and configure the production domain before publishing a production deployment.

After the host signs in once, open that user in Clerk’s dashboard and set Public metadata to:

```json
{"role":"admin"}
```

Admin authorization reads currentUser().publicMetadata on the server. ADMIN_EMAILS is not used. No role can be supplied in an API request. Session-token customization is optional because this app does not trust cached client claims; if another frontend needs the metadata, the Clerk session token customization is:

```json
{"publicMetadata":"{{user.public_metadata}}"}
```

Use a production Clerk instance for a lasting public deployment. Development instances display Clerk’s development notice.

## Running

With Docker and Compose installed:

```sh
cp .env.example .env.local
# Fill in the keys and exact origin.
docker compose --env-file .env.local up -d --build
```

The web server is published only on 127.0.0.1 and APP_PORT. Put your HTTPS reverse proxy or tunnel in front of it. MongoDB has no published port and joins only an internal Compose network. The application reaches it by the service hostname mongo. The persistent room-data volume contains wallets, room state, and audit history. Back it up and restrict access to the Docker host.

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

Prices are fetched by the server approximately every three seconds. Orders fail closed if a quote is unavailable or more than ten seconds old. Liquidations are checked only when a fresh quote arrives. Outages and price gaps can therefore skip an intragap liquidation; this is not a real exchange or a continuous matching engine.

Long liquidation is entry × (1 − 1/leverage) / (1 − maintenance). Short liquidation is entry × (1 + 1/leverage) / (1 + maintenance). An administrator’s explicit threshold overrides that formula for the selected position. Maintenance changes update existing formula-based positions. Setting a threshold across the current price can immediately liquidate the position. Liquidation consumes the entire isolated margin and never the rest of the wallet.

Quotes and charts can differ. Unrealized standings use the last available quote and can be stale during an outage. No historical price replay or financial accuracy guarantee is provided.

All bankroll writes use optimistic compare-and-swap against one Mongo room document, which also keeps poker chips and financial holdings atomic with cash. Request IDs with short expiry prevent duplicate financial actions; Mongo-backed counters rate-limit requests. Private cards, decks, internal user IDs, other users’ portfolio details, and admin-only emails are never sent in ordinary player snapshots.

This one-room design is intended for a small group, not an unbounded public casino. Administrator audit events first enter the same atomic room update, then are idempotently copied to the audit collection. Pending events remain durable and retry on subsequent updates after an audit-write outage. Administrators with direct database access can change the data; the audit is not a tamperproof external ledger.
