# ssg200x

[![Docker image](https://github.com/koboshchan/ssg200x/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/koboshchan/ssg200x/actions/workflows/docker-publish.yml)

A private, web-only room for poker, blackjack, roulette and crypto paper trading. Each player starts with $1,000 in shared play money. Google sign-in and invitations are managed through Clerk.

No deposits, withdrawals or cash prizes.

## Features

- **Poker** at `/poker`: six-seat no-limit hold’em, $1/$2 blinds and a live $5 UTG straddle with three or more players. Everyone seated must press Ready before a hand starts; readiness resets after five minutes if someone is missing. Cash out when unready and outside an unsettled hand.
- **Blackjack** at `/blackjack`: three shared six-seat tables, six-deck shoes, hit/stand/double/split, dealer stands on soft 17, natural blackjack pays 3:2.
- **Roulette** at `/roulette`: one shared European single-zero wheel. Sixty-second rounds have 55 seconds of betting and five seconds locked. Bets clear after each spin; Last bet repeats the previous round when funds permit.
- **Markets** at `/markets`: fractional crypto spot holdings and isolated long/short perpetuals at 1–200× leverage. Persisted TP/SL, server-side liquidation and private closed-position history. Settings beside the avatar let each user enter triggers as prices or dollar profit/loss amounts.
- **Standings** at `/standings`: net worth includes cash, chips, holdings and open-position equity. Administrator cash adjustments do not inflate profit standings.
- **Administration** at `/players`: account balances, portfolios, risk limits, maintenance margin and liquidation overrides, with durable audit records.
- **Live updates** over one authenticated WebSocket connection: games, prices, P/L, balances and maintenance. HTTP handles initial reads and actions, not periodic live-data polling. Cards and portfolios are scoped to the signed-in player.

Payment requests at `/wallet` are receiver-created: the receiver fixes the amount and generates a four-word code that expires after ten minutes. The sender enters only the code, previews the recipient and fixed amount, then confirms payment. Codes are single-use and guessing is rate-limited. Administrators preview an Airdrop and explicitly confirm it before any balances change.

Cards and roulette use OS cryptographic randomness. Financial writes use Mongo compare-and-swap and request receipts to prevent double spending and duplicate actions.

## Stack

Node.js 24, TypeScript, Next.js App Router, React, Socket.IO, MongoDB 8, Clerk, Zod, pokersolver and TradingView Lightweight Charts. Docker uses separate dependency, build and non-root runtime stages.

## Prerequisites

For containers, install Docker Engine or Docker Desktop and a recent Compose v2 with support for `!reset` overrides. For development outside Docker, use Node.js 24 and a reachable MongoDB 8 replica set. Transactions require a replica set; a standalone Mongo instance is not sufficient.

Create a Clerk application before starting the app.

## Clerk setup

1. Enable **Google only** for sign-in/sign-up. Disable passwords, email codes and other providers.
2. Set sign-up mode to **Restricted** and send invitations from the Clerk dashboard. There is no in-app approval queue or invitation endpoint.
3. Copy the publishable and secret keys into your local environment file. Use development keys locally and production keys for a lasting deployment.
4. After the administrator signs in, set their Clerk **Private metadata** to:

   ```json
   {"admin":true}
   ```

The server checks the current Clerk user and verified Google identity. Administrator access requires `user.privateMetadata.admin === true` from the Clerk Backend User. Only the boolean `admin` in server-generated maintenance/room responses reaches the client; private metadata is never serialized, added to session claims or read by client code. Public/unsafe metadata, session roles and `ADMIN_EMAILS` do not grant access. HTTP endpoints fetch the current user server-side; WebSocket authentication fetches the user on every connection/token renewal. Reconnect after changing metadata (existing sockets expire with their Clerk token). Middleware verifies sign-in only and never derives an admin role; API and socket handlers enforce authorization.

> [!IMPORTANT]
> `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is embedded in the client build. Rebuild when changing Clerk instances. Never put `CLERK_SECRET_KEY` into a build argument, image layer or Git commit.

## Quick start with Docker Compose

Clone the private repository, then create your environment file:

```sh
git clone https://github.com/koboshchan/ssg200x.git
cd ssg200x
cp .env.example .env.local
# Edit .env.local with your Clerk keys and exact browser origin.
docker compose --env-file .env.local up -d --build
```

Open [http://localhost:43891](http://localhost:43891), or the port configured in `APP_PORT`.

The app binds to loopback. Mongo has no published port, no authentication, and belongs only to an internal Compose network. The app connects through `mongodb://mongo:27017/?replicaSet=rs0&directConnection=true`. Database files persist in the gitignored `./data/mongo` bind mount. Restrict Docker-host access and back up that directory using a consistent Mongo backup or while Mongo is stopped.

```sh
docker compose --env-file .env.local logs -f app
docker compose --env-file .env.local down
```

Stopping containers does not remove the database bind mount.

Mongo runs as a single-node replica set named `rs0`, with `mongo:27017` as its sole member. The healthcheck initializes only an unconfigured replica set (`NotYetInitialized`) and reports healthy only when `rs0` has a writable primary. Connection, permission and configuration errors fail the check instead of triggering initialization. The app waits for this healthcheck. Restarts reuse the stored replica-set configuration without reinitializing it. `directConnection=true` targets this one Docker member; `replicaSet=rs0` requires the expected set.

A single node enables multi-document transactions but provides no redundancy or failover. Keep backups; do not expose this unauthenticated database outside the internal network.

## Existing standalone database upgrade

Lucas redeploys manually. Publishing commits or images does not change the running stack.

Keep the existing `./data/mongo:/data/db` mount and use the same MongoDB 8.0 image version as the standalone database. Before redeploying, stop app writes, shut Mongo down cleanly and make an independent copy of the entire stopped data directory. Do not copy WiredTiger files while Mongo is running, delete the directory or start two Mongo processes against it.

Test the update on that independent copy in an isolated Compose project first. The updated Mongo command starts the same database files with `--replSet rs0`; its healthcheck creates the single-member configuration only if none exists. Confirm the copied documents and indexes match the standalone fixture, a multi-document transaction commits, an aborted transaction leaves no changes, and a second start remains healthy without changing the replica-set configuration.

For the manual deployment, use the existing Compose project and environment file so the bind mount stays unchanged. Stop app writes before recreating Mongo, wait for it to become healthy, then recreate the app so it receives the updated URI:

```sh
docker compose --env-file .env.local stop app mongo
# Back up the stopped ./data/mongo directory before continuing.
docker compose --env-file .env.local up -d --wait mongo
docker compose --env-file .env.local up -d --build app
docker compose --env-file .env.local ps
docker compose --env-file .env.local exec mongo mongosh --quiet --eval 'db.adminCommand({hello:1})'
```

Keep any existing deployment override files and project-name options on every command. The final check must show `setName: "rs0"` and `isWritablePrimary: true`. If Mongo remains unhealthy, inspect its logs and healthcheck output. Do not force `rs.initiate()`, reconfigure an existing set, erase data or downgrade Mongo to bypass an error. Retain the untouched backup and investigate before resuming writes.

Existing stored Mongo candles are preserved and remain readable. Only future live observations add candles; a fresh database starts collecting when its feed starts. There is no first-boot import or historical Binance/Coinbase fetch to fill missing bars. Maintenance is controlled manually, not by an import job.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Required Clerk publishable key. Used at build time and runtime; must match the secret key's instance. |
| `CLERK_SECRET_KEY` | Required server-only Clerk secret. Runtime environment only. |
| `APP_ORIGIN` | Exact browser origin, such as `http://localhost:43891`. Used by CSRF and WebSocket origin checks. No trailing path. |
| `APP_PORT` | Host port for Compose; defaults to `43891`. |
| `MONGODB_URI` | Mongo connection URI. Compose supplies `mongodb://mongo:27017/?replicaSet=rs0&directConnection=true`; native development needs a host-reachable replica-set URI. |
| `MONGODB_DB` | Database name; defaults to `pokerroom`. The base Compose file sets this explicitly. |
| `PORT` / `HOSTNAME` | Native server listener; defaults to `3000` / `0.0.0.0`. Compose sets these inside the container. |
| `DEV_ALLOWED_ORIGINS` | Comma-separated development hostnames for Next HMR, without a scheme. Configure when using a development tunnel. |
| `IMAGE_TAG` | GHCR override image tag; defaults to `latest`. |

Next loads `.env.local` for native development. Compose receives it through `--env-file`; the file is excluded from Git and Docker build context.

The base Compose file forwards the required app variables. Optional native-development variables must also be added to the app service environment when you want them inside a container.

## GHCR images

The publishing workflow builds `ghcr.io/koboshchan/ssg200x` on pushes to `main`, version tags matching `v*`, or manual dispatch. It uses `GITHUB_TOKEN` with package-write permission, pinned Docker actions and GitHub Actions build cache.

Set the repository Actions secret `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the production publishable key before running the workflow. The Clerk secret key is supplied only when running the image.

Tags include `latest` on main, `sha-<full-commit>`, and version/major-minor tags for semantic version releases. Publishing an image does not deploy it.

For private-package access, authenticate Docker with a GitHub credential permitted to read the package, then run the existing Compose stack with the image override:

```sh
docker login ghcr.io
docker compose --env-file .env.local -f compose.yaml -f compose.ghcr.yaml pull
docker compose --env-file .env.local -f compose.yaml -f compose.ghcr.yaml up -d --no-build
```

Set `IMAGE_TAG` to a specific version or commit tag to pin a release. Use the same production Clerk instance as the image's embedded publishable key. For a different instance, build locally with your own key.

## Development

Install dependencies once:

```sh
npm ci
cp .env.example .env.local
```

For a native dev server, set these values in `.env.local`, alongside Clerk keys:

```dotenv
APP_ORIGIN=http://localhost:43891
PORT=43891
HOSTNAME=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true
MONGODB_DB=ssg200x_dev
```

Then run:

```sh
PORT=43891 HOSTNAME=127.0.0.1 npm run dev
```

The supplied Compose Mongo is deliberately not host-accessible. Use your own development replica set named `rs0` for the native server, or run the dev server inside Compose after installing dependencies:

```sh
docker compose --env-file .env.local -f compose.yaml -f compose.dev.yaml up -d
```

The override mounts the checkout at `/work` and runs the custom Node server in development mode. Install Linux-compatible dependencies when running this container on another host platform. For a production-style native run, build first, then use `PORT=43891 HOSTNAME=127.0.0.1 npm start`. The custom server reads its listener variables before Next loads `.env.local`, so export `PORT` and `HOSTNAME` in the shell.

A reverse proxy or tunnel must forward WebSocket upgrades. Set `APP_ORIGIN` to its exact public origin and, for Next development HMR, set `DEV_ALLOWED_ORIGINS` to its hostname. Development-tunnel HMR configuration does not change production authorization.

## Tests

```sh
npm test
npm run typecheck
npm run build
MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true' \
  MONGODB_DB=fakebucks_test_local npm run test:integration
```

Integration tests refuse database names without the historical `fakebucks_test_` prefix. They create synthetic users, exercise persistence/concurrency/privacy and remove their isolated test databases. Never point them at the application database.

The app has no test authentication bypass.

## Market data and settlement

The crypto allowlist is BTC, ETH, BNB, XRP, SOL and LTC. Change `lib/market-config.ts` to update trading and live charts together. Unavailable products are not silently replaced.

One persistent server-side native Node WebSocket subscribes to the public Coinbase Exchange ticker and heartbeat channels for the configured USD products. A global singleton survives Next HMR; a renewed 15-second Mongo leader lease selects one feed owner across processes. An independent 100ms watchdog closes the connection before lease expiry, and any observed database/worker error closes it immediately. This is bounded lease ownership, not a mathematical guarantee of one physical TCP connection during arbitrary OS process suspension or network partitions; deployments requiring that stronger invariant must use a dedicated feed-service owner. Every accepted ticker goes through serial room CAS settlement, including intermediate same-millisecond TP/SL or liquidation crossings, with no connected clients required. Candle extrema and bucket rollovers are persisted before draining the next batch. The bounded 4,096-tick queue disconnects and reports overload rather than silently coalescing crossings. Disconnects and 10-second transport stalls reconnect with capped exponential backoff and resubscribe. Heartbeats never refresh quote timestamps. Exchange timestamps up to one second ahead are accepted with cache timestamps clamped to server receipt time; farther-future events fail closed. Invalid products, prices, future/stale times and duplicate/out-of-order sequences are rejected.

The first ten seconds after worker creation are WebSocket-only startup grace. Thereafter, only products whose ticker marks are older than ten seconds use the existing batched Coinbase USD rates REST fallback, with the existing once-per-second idle / 200ms active target and 429 backoff. Fallback uses one Mongo-backed request budget, with at least 334ms between requests across processes. Healthy symbols are excluded from fallback writes; when all are healthy no REST request is made. Unchanged REST rates do not renew freshness because that endpoint supplies no event timestamp. Missing or stale quotes block fills. Unsupported or omitted ticker subscriptions are logged as feed-health failures without expanding the whitelist. They remain eligible for stale-mark REST fallback after startup grace, but that fallback is best-effort, not a promise of fresh quotes: missing or unchanged rates remain unavailable/stale and fills stay blocked. A successful subscription also does not promise a trade every ten seconds for every product. Product availability can change. See [Exchange protocol](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) and [ticker schema](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels#ticker-channel).

Stored Mongo candles remain readable. New candle buckets come only from accepted live quotes and stale-mark fallback observations, not historical candle downloads. Missing bars stay missing, including gaps while the app is offline. New observations have unknown volume, recorded as zero. No background import, progress polling or automatic import-related maintenance runs; the manual maintenance switch remains available.

Perpetuals simulate isolated margin with no fees, slippage, funding or order book. A price gap may fill a trigger beyond its target; liquidation takes priority and consumes the isolated margin, not the remaining wallet. Charts and marks can differ. This is a small-group simulation, not an exchange.

## Troubleshooting

**Sign-in or actions fail:** check that both Clerk keys belong to the same instance, Google is enabled, the account is invited, and `APP_ORIGIN` exactly matches the browser origin.

**WebSocket stays offline:** check proxy upgrade forwarding and the origin. Check `DEV_ALLOWED_ORIGINS` separately for development HMR issues.

**Players see maintenance:** sign in as an admin to inspect the manual maintenance switch.

**Changed publishable key has no effect:** rebuild the local image, or use a GHCR build made for that Clerk instance.

## References

[Clerk dashboard](https://dashboard.clerk.com/) · [Docker Compose](https://docs.docker.com/compose/) · [Container publishing workflow](.github/workflows/docker-publish.yml)

## Public leaderboard

Anyone can open `/leaderboard`, including while sign-in is unconfigured or the site is under maintenance. Navigation and the sign-in landing link to it. This server-rendered page sits outside the authenticated room layout and bypasses Clerk middleware for that exact path only. Other pages and API protections are unchanged.

A read-only Mongo query computes net worth from the same wallet, poker, blackjack, roulette and marked portfolio components as signed-in standings. It does not register visitors, initialize the room, tick games, fetch prices or write state. A per-process, 15-second cache coalesces concurrent loads and stores only the sanitized snapshot. Reload after expiry for a fresh snapshot; empty databases show an empty state and database failures show a generic message.

Public rows contain only rank, display name, locally generated initials avatar and net worth in cents. No Clerk/account/public IDs, emails, avatar URLs, wallet breakdowns, holdings, positions, cards, roles or private metadata are serialized. Email-like names and Clerk ID-like names become “Player”; avatar initials avoid external tracking requests and identifiers in image URLs. Equal worth sorts by display name, then stored order.
