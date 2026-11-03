Trusted-server CS2 custom buy example

This directory is an executable TypeScript HTTP client and durable purchase state machine with an injected game-thread bridge. It is not a compiled C# plugin and has not been run against CS2 or CounterStrikeSharp. Local tests exercise mocks, SQLite restart persistence and HTTP request construction, not live SSG or native game behavior. No live requests or production secrets are needed for the tests.

Run from the repository with Node 24 and installed project dependencies.

```sh
npx tsx --test examples/cs2/outbox.test.ts
npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --target ES2022 --module esnext --moduleResolution bundler examples/cs2/*.ts
```

The runtime uses Node's built-in node:sqlite module, which is experimental on Node 24. DatabaseSync and its prepare/get/run/all methods are synchronous. Keep it in the trusted integration service, not the game thread. WAL and synchronous FULL are explicit. Use one protected local database directory per server instance, preserve the database and WAL during backups, and do not place them on NFS, a public web root or ephemeral container storage. Restrict the directory to the service account before opening it. Keep server instance IDs stable across restarts and unique across independently restored installations.

Configure SSG_API_ORIGIN to the trusted HTTPS origin, SSG_CLIENT_ID to the public client ID and SSG_APP_SECRET to the complete one-time secret. Only the trusted server/service may read them. They must never enter a browser bundle, player download, query string, console transcript or chat. SsgClient refuses HTTP and redirects; the API itself rejects browser Origin headers. Do not expose a public sidecar endpoint that lets callers invent SteamIDs, sessions, prices or delivery outcomes. Any local plugin bridge must authenticate its peer and restrict access to the trusted game-server process.

A custom !link command first captures the authenticated server-side player's authorized Steam identity as a decimal string. Do not accept a nickname, slot alone, client-supplied identity or a JavaScript number. createLink generates four independent CSPRNG words using the same BIP39 English vocabulary as the backend and sends an external_subject identifying both stable server instance and SteamID64. Words can repeat because sampling is independent. The API validates the code before it is displayed. The server must keep pending request/device-token and original Steam identity/session privately until expiry, display the returned words and verification_uri only to that player, and poll no faster than the returned interval. Respect 429 and Retry-After.

On an approved poll, require granted_scopes to include balance:debit before calling bindApproved with the original trusted SteamID64, app_user_id and grant_id. Never derive the binding from the four words or the current occupant of an old slot. The example stores approved bindings durably and rejects overwrites and duplicate app-user bindings. Explicit unlink/relink requires a reviewed operator procedure that drains outstanding purchases and resolves conflicting identities first. Reconsent after expiry or policy changes is necessary; a stored mapping alone never authorizes spending. The sample intentionally provides no public linking bridge or polling daemon, so the embedding service must implement private pending-link storage, expiry and player-only display.

A custom !buy deagle command uses the fixed server price PRICE_CENTS, exactly 70000 simulation cents. The command must reject other items rather than interpreting arbitrary player input as a price, API path or engine command. Capture a PlayerSession while on the game thread, with verified SteamID64 plus unpredictable connection generation, current map generation and current pawn/spawn generation. Generate new connection/pawn/map generations for reconnects, respawns and map changes; never reuse slot or raw pointer values as durable identity.

Call enqueueDeagle once for that user action, save its returned purchase ID, then call process off the game thread. An explicit second purchase is a different action, but recovery of an existing one must reuse its durable ID. Rate-limit commands and show a pending message rather than enqueueing duplicates when a player's existing purchase is unresolved. The SQLite enqueue transaction enforces one unresolved purchase per player, including manual-review rows. The embedding must also bound and rate-limit its reconciliation queue. The outbox writes the row with fixed price semantics before any HTTP call, then derives stable distinct debit and refund keys from server ID and UUID.

```ts
import { SsgClient } from "./client";
import { PurchaseOutbox } from "./outbox";
import { gameAdapter, type GameThreadBridge } from "./adapter";

// Trusted service initialization, never client/browser code.
const api = SsgClient.fromEnv();
const box = new PurchaseOutbox("/protected-local-state/purchases.db", "unique-server-1");

// The embedding plugin supplies a verified, version-pinned native bridge.
// This declaration is a contract, not an implemented C# bridge.
declare const bridge: GameThreadBridge;
const game = gameAdapter(bridge);

// After trusted linking and a fresh server-side session capture, enqueue once.
// const purchase = box.enqueueDeagle(capturedSession);
// await box.process(purchase.id, api, game);

// Bounded recovery, with backoff in the embedding service.
// for (const p of box.pending(50)) await box.process(p.id, api, game);
```

The debit phase first looks up its key. If a prior request committed but lost its response, the stored receipt advances the existing row without another charge. A missing lookup may be followed only by the identical debit and identical key. A pending original request can still commit after a lookup returns 404; server idempotency, not the 404, prevents duplication. A receipt must match user, fixed amount, direction and external purchase reference before delivery. Rejected funds or scope checks give no item. Transport/timeout/errors leave the purchase pending; they are not evidence of nonpayment. Apply bounded exponential backoff and honor 429 rather than tight retry loops. Permanent 4xx failures require operator attention or explicitly cancelling a verified uncommitted pending action, never a fresh key.

The engine adapter first persists delivery_attempted, then schedules exactly one synchronous game-thread callback. In that callback it reacquires the currently authorized player/controller and pawn, validates all Steam/connection/map/pawn generations, verifies alive/team/buy-zone/round/inventory eligibility under the server's rules, then gives weapon_deagle without subtracting engine cash. All checks and delivery happen in the same callback without awaiting. GameThreadBridge.currentAuthorizedSession, eligibleForDeagle and giveDeagle are native adapter responsibilities. The supplied adapter.ts enforces same-session comparisons around those responsibilities and treats thrown scheduling/delivery errors as unknown.

The native bridge must not keep GameEvent, native controller or pawn references across asynchronous work. Convert identity to plain immutable values before leaving the game thread. Reject bots, absent AuthorizedSteamID and invalid handles. A successful give must be verified against the installed API and item instance. A zero/uncertain native result or exception after possible creation is unknown, not proof of failure. An item dropped at the wrong place or wrong recipient is also not a safe no-side-effect failure.

A known pre-delivery session mismatch or ineligibility returns not_delivered, moving the durable row to pending_refund. Refunds use the original debit ID and a deterministic refund key, for exactly the original 70000 cents in this example. The backend bounds cumulative refunds to the app's own original debit and supports compensation after user grant revocation within its ninety-day window. A revoked credential, suspended app, maintenance or access-revoked user may block compensation. Leave that row pending for review. Never relabel refunds as minting or automatically return more than the original charge.

A timeout after scheduling, a crash during item delivery, or a crash after give but before recording success cannot be atomically reconciled with the financial ledger. The row remains delivery_attempted, or becomes manual when uncertainty is observed. Neither state automatically re-gives or refunds. On startup, inventory delivery cannot be inferred merely from the SSG receipt. An operator must correlate the exact purchase/session, debit/refund receipts and authoritative game logs, record an audit decision and perform a bounded original-debit refund or acknowledge verified delivery. If evidence is inconclusive, keep it unresolved rather than blindly granting an item and a refund. This example intentionally has no automated manual-resolution command. Never directly edit its SQLite state while a worker might still be executing a queued callback.

The service can safely stop and restart with pending_debit, debited or pending_refund rows. Restarted delivery_attempted rows require manual reconciliation, even if delivery may never have begun. pending(limit) reads at most one hundred rows at a time. Keep the durable purchase's original session even after restart; no reattachment to the same account's newer connection or pawn is allowed.

This is only the custom !buy path. It does not replace or claim to cancel the ordinary engine buy menu. If the server wants every purchase to use SSG currency, disable ordinary engine purchases using a separately verified server configuration/interception and test it on the installed version before enabling the integration. A post-purchase EventItemPurchase handler or setting DontBroadcast is not proof an engine purchase was cancelled. Do not debit SSG after an already completed ordinary purchase and pretend it is an atomic payment hook.

CounterStrikeSharp documentation was checked fresh on November 2, 2026. Its player guide distinguishes controllers from pawns and requires handle validation. The controller reference documents nullable AuthorizedSteamID, validated with SteamAPI, and GiveNamedItem(string), returning a native pointer. Server.NextFrameAsync runs a callback on the next game frame but does not execute while the server is hibernating. NextWorldUpdateAsync is documented to execute during hibernation; selecting it still requires installed-version and eligibility testing. An unbounded scheduling wait must not be misclassified as known-no-delivery. EventItemPurchase exposes purchaser and weapon; event broadcast suppression is documented separately from engine transaction cancellation.

The referenced current APIs are at https://docs.cssharp.dev/docs/guides/referencing-players.html , https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.CCSPlayerController.html , https://docs.cssharp.dev/api/CounterStrikeSharp.API.Server.html , https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventItemPurchase.html and https://docs.cssharp.dev/docs/features/game-events.html . Node SQLite reference is https://nodejs.org/api/sqlite.html and durability background is https://sqlite.org/wal.html . No CounterStrikeSharp entry was available in the fetched API-doc index, so these official sources were read directly. Pin and compile the actual native bridge against the installed CounterStrikeSharp release before claiming plugin compatibility.

Before real use, test same-player reconnects with reused slots, respawn and map changes during HTTP, insufficient funds, lost commit replies, duplicate commands and worker calls, stale credentials, grant revoke, consent renewal, app suspension, partial/concurrent refunds, disk-full outbox writes, hibernating scheduling and crashes both before and after native item creation. The included mock tests cover the TypeScript state machine, fixed price, identity comparisons, bounded refund payload, failed/ambiguous delivery and confidential HTTP headers. They do not establish game-native scheduling, item creation, engine-purchase blocking or live backend transaction correctness.
