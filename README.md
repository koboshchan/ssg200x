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
- **Live updates** over one authenticated WebSocket connection: games, prices, P/L, balances, maintenance and history progress. HTTP handles initial reads and actions, not periodic live-data polling. Cards and portfolios are scoped to the signed-in player.

Cards and roulette use OS cryptographic randomness. Financial writes use Mongo compare-and-swap and request receipts to prevent double spending and duplicate actions.

## Stack

Node.js 24, TypeScript, Next.js App Router, React, Socket.IO, MongoDB 8, Clerk, Zod, pokersolver and TradingView Lightweight Charts. Docker uses separate dependency, build and non-root runtime stages.

## Prerequisites

For containers, install Docker Engine or Docker Desktop and a recent Compose v2 with support for `!reset` overrides. For development outside Docker, use Node.js 24 and a reachable MongoDB instance.

Create a Clerk application before starting the app.

## Clerk setup

1. Enable **Google only** for sign-in/sign-up. Disable passwords, email codes and other providers.
2. Set sign-up mode to **Restricted** and send invitations from the Clerk dashboard. There is no in-app approval queue or invitation endpoint.
3. Copy the publishable and secret keys into your local environment file. Use development keys locally and production keys for a lasting deployment.
4. After the administrator signs in, set their Clerk **Public metadata** to:

   ```json
   {"role":"admin"}
   ```

The server checks the current Clerk user and verified Google identity. Administrator access comes from server-read public metadata, never a role supplied by the browser. `ADMIN_EMAILS` is not used.

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

The app binds to loopback. Mongo has no published port, no authentication, and belongs only to an internal Compose network. The app connects through `mongodb://mongo:27017`. Database files persist in the gitignored `./data/mongo` bind mount. Restrict Docker-host access and back up that directory using a consistent Mongo backup or while Mongo is stopped.

```sh
docker compose --env-file .env.local logs -f app
docker compose --env-file .env.local down
```

Stopping containers does not remove the database bind mount.

> [!NOTE]
> First boot imports candle history for all configured markets. Non-admins see maintenance until bootstrap finishes; admins can enter the app and watch progress. Leave disk space for the database and archives. Imports pause below the two-GiB free-space guard and resume rather than count the pause as completion.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Required Clerk publishable key. Used at build time and runtime; must match the secret key's instance. |
| `CLERK_SECRET_KEY` | Required server-only Clerk secret. Runtime environment only. |
| `APP_ORIGIN` | Exact browser origin, such as `http://localhost:43891`. Used by CSRF and WebSocket origin checks. No trailing path. |
| `APP_PORT` | Host port for Compose; defaults to `43891`. |
| `MONGODB_URI` | Mongo connection URI. Compose supplies `mongodb://mongo:27017`; native development needs a host-reachable URI. |
| `MONGODB_DB` | Database name; defaults to `pokerroom`. The base Compose file sets this explicitly. |
| `PORT` / `HOSTNAME` | Native server listener; defaults to `3000` / `0.0.0.0`. Compose sets these inside the container. |
| `DEV_ALLOWED_ORIGINS` | Comma-separated development hostnames for Next HMR, without a scheme. Configure when using a development tunnel. |
| `CANDLE_BACKFILL_DISABLED` | Set to `1` to skip historical imports in a disposable development/test environment. |
| `CANDLE_STORAGE_PATH` | Filesystem path used for the history worker's free-space check; defaults to the process working directory. |
| `IMAGE_TAG` | GHCR override image tag; defaults to `latest`. |

Next loads `.env.local` for native development. Compose receives it through `--env-file`; the file is excluded from Git and Docker build context.

The base Compose file forwards the required app variables. Optional native-development variables must also be added to the app service environment when you want them inside a container. `compose.dev.yaml` already forwards `CANDLE_BACKFILL_DISABLED`.

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
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=ssg200x_dev
```

Then run:

```sh
PORT=43891 HOSTNAME=127.0.0.1 npm run dev
```

The supplied Compose Mongo is deliberately not host-accessible. Use your own development Mongo for the native server, or run the dev server inside Compose after installing dependencies:

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
MONGODB_URI=mongodb://127.0.0.1:27017 \
  MONGODB_DB=fakebucks_test_local npm run test:integration
```

Integration tests refuse database names without the historical `fakebucks_test_` prefix. They create synthetic users, exercise persistence/concurrency/privacy and remove their isolated test databases. Never point them at the application database.

The app has no test authentication bypass.

## Market data and settlement

The allowlist is BTC, ETH, BNB, XRP, SOL, ZEC, HYPE, DOGE, LINK, ADA, NEAR, XLM, BCH, LTC, UNI, AVAX, SUI, HBAR, TAO and SHIB. Change `lib/market-config.ts` to update trading, charts and import jobs together. Unavailable products are not silently replaced.

One server-side batched Coinbase USD rates request runs about once per second while idle, or up to five times per second with open perpetuals. Browsers and order requests read the cache. Missing quotes or quotes older than ten seconds block fills. Liquidation and persisted TP/SL run on price ticks even with no connected clients and resume after restart.

Historical candles use the last twelve complete monthly Binance USDT one-minute archives, plus Coinbase USD pages for the current month. The worker aggregates other intervals locally, persists progress and continues with Coinbase updates. Archive USDT references are not USD executions. Missing products are marked unavailable; automatic maintenance ends only when bootstrap work is complete or explicitly unavailable. Manual maintenance is independent.

Perpetuals simulate isolated margin with no fees, slippage, funding or order book. A price gap may fill a trigger beyond its target; liquidation takes priority and consumes the isolated margin, not the remaining wallet. Charts and marks can differ. This is a small-group simulation, not an exchange.

## Troubleshooting

**Sign-in or actions fail:** check that both Clerk keys belong to the same instance, Google is enabled, the account is invited, and `APP_ORIGIN` exactly matches the browser origin.

**WebSocket stays offline:** check proxy upgrade forwarding and the origin. Check `DEV_ALLOWED_ORIGINS` separately for development HMR issues.

**Players see maintenance:** sign in as an admin to inspect backfill progress, storage status and the manual maintenance switch.

**Changed publishable key has no effect:** rebuild the local image, or use a GHCR build made for that Clerk instance.

## References

[Clerk dashboard](https://dashboard.clerk.com/) · [Docker Compose](https://docs.docker.com/compose/) · [Container publishing workflow](.github/workflows/docker-publish.yml)
