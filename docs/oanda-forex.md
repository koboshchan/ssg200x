# OANDA practice forex

One shared server HTTP pricing stream supplies eight explicit native pairs. No REST quotes or fallback. REST instruments metadata validates admin additions only. Canonical defaults are EUR/USD, USD/JPY, GBP/USD, USD/CNH, USD/CAD, AUD/USD, USD/CHF and AUD/JPY. CNY is never substituted for CNH. Unsupported, inverse and duplicate pairs are rejected. Removals preserve direct and dependent conversion claims.

Native marks, entries, triggers and candles use the midpoint of best positive liquid bid and ask. This is a make-believe midpoint policy, not executable bid/ask simulation. Both provider event and monotonic receipt age must be at most 10 seconds for every leg. Future timestamps, invalid/crossed books, nontradeable status, disconnect and ownership uncertainty fail closed. Heartbeats never refresh quotes. Mongo ownership, host clock domain and stream generation fence publications.

Spot holdings represent base units valued in USD. USD/JPY spot holds USD at a constant dollar baseline; it is not a JPY directional position. AUD/JPY spot AUD value uses AUDJPY / USDJPY with independently fresh legs and no ninth subscription.

Perpetuals retain native entry and fixed base exposure. USD P/L is base units times native price change times current USD-per-quote conversion times direction. USD/JPY is inverse USD P/L, never a constant-dollar mark. AUD/JPY retains its JPY exposure rather than becoming an AUD/USD contract. Closing fees use converted USD notional. Increases combine exposure-weighted native entries; partial closes split base exposure proportionally. Cross liquidation display is indicative at the latest conversion; settlement always requires fresh native and conversion legs.

Server credentials are OANDA_API_TOKEN and OANDA_ACCOUNT_ID. They never enter browser responses. Optional OANDA_OBSERVATION_FILE contains sanitized timestamps under the private /home/kit/forex-evidence directory. No real trade or account mutation endpoints are used.
