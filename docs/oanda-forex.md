# OANDA practice forex

The server owns one shared OANDA practice HTTP pricing stream, serialized across configuration changes. There is no REST quote fallback. REST instruments metadata is used only for explicit admin validation. The eight supported native instruments are EUR/USD, USD/JPY, GBP/USD, USD/CNH, USD/CAD, AUD/USD, USD/CHF and AUD/JPY. CNY is not substituted for CNH. Unsupported, inverse and duplicate pairs are rejected. Removal preserves open claims and dependent conversion claims.

Marks, entries, triggers and candles use the midpoint of best positive liquid bid and ask. This is a make-believe midpoint policy, not an executable OANDA bid/ask simulation. Every native quote and conversion leg must have both a provider event age and monotonic receipt age at most 10 seconds. Future timestamps, crossed or invalid books, untradeable status, disconnection and ownership uncertainty fail closed. Heartbeats never refresh prices. Persistent states are fenced by the Mongo worker lease and the host monotonic clock domain. Publication generation checks also prevent a cancelled configuration publishing over its successor.

Native price is not USD value. Spot holdings retain base units and are valued in USD per base unit. A USD/JPY spot holding therefore holds USD and has a constant dollar baseline; it is not a leveraged bet on JPY. AUD/JPY spot base AUD is valued using AUDJPY / USDJPY, with both legs independently fresh. This route never opens a ninth subscription.

Perpetual positions retain native entries, fixed base exposure and current USD-per-quote conversion. USD P/L equals base exposure times native price change times current USD-per-quote conversion, with the position direction applied. In particular USD/JPY is inverse USD P/L, not a constant-dollar mark, and AUD/JPY retains its JPY exposure rather than silently becoming an AUD/USD contract. Closing fees use current converted USD notional. Increases combine exposure-weighted native entries; partial closes split base exposure in the same proportion as margin. Cross liquidation display is indicative at the latest conversion; settlement always checks fresh native and conversion quotes.

Configuration uses server-only OANDA_API_TOKEN and OANDA_ACCOUNT_ID. Credentials never enter browser responses. Optional OANDA_OBSERVATION_FILE writes sanitized timestamps only to the private /home/kit/forex-evidence directory. No provider account actions or real trading endpoints are used.

## Deployment isolation and provider limits

FX streaming defaults OFF in every environment, even with credentials and
NODE_ENV=production. Explicitly set FX_STREAM_ENABLED=true AND FX_STREAM_ENV
(a stable 1-64 character alphanumeric, underscore or hyphen deployment namespace)
to opt in. Any other value, missing namespace, or missing credentials fails closed.
Demos must remain FX_STREAM_ENABLED=false unless intentionally testing. Never
infer deployment identity from NODE_ENV; a built demo also uses production mode.
Use separate databases for environments. The FX worker holds a dedicated
`oanda-feed:<FX_STREAM_ENV>` lease and releases only that exact ID and owner;
crypto's lease does not authorize an OANDA connection. Disable is checked on each
worker step, aborts the connection, discards prices/held frames/timers and releases
the owned FX lease. Deployment environment changes require a process restart.

OANDA's development guide documents **20 active streams per requesting IP** and
at most **2 new connections/second**. It does not document a one-stream-per-token
or per-account limit. The comparison page separately says “Streams per user:
Aggregate of 20 connections”, so do not assume different tokens or accounts exempt
a shared egress IP from the documented IP cap. Separate practice accounts/tokens
are recommended for dev to isolate credentials/account activity; different tokens
for the same account are not an isolation guarantee, nor are separate accounts a
way around IP quotas. Our environment leases only coordinate our own processes,
not provider quotas across deployments.

Sources checked for this release:
https://developer.oanda.com/rest-live-v20/development-guide/
https://developer.oanda.com/rest-live-v20/api-comparison/
