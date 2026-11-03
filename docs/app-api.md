SSG application API v1

This guide describes the implementation on the kat/app-api branch, not a deployed service. Deployment requires a separate reviewed release. All money is SSG simulation currency. One hundred ssg_cent units equal one simulation dollar. These balances are not bank deposits, real USD, or withdrawable money. Purchases burn simulation currency; they do not pay the application's owner.

A confidential backend registers an application through authenticated developer settings, requests review, and stores its one-time credential securely. Draft and pending applications cannot link or spend. An administrator must approve scopes and limits. Arbitrary rewards require separately approved mint mode and positive mint budgets. Refund-only is the default credit policy.

Every external request uses HTTPS with Authorization set to Bearer followed by the complete one-time secret, which has the form ac_<credential-uuid>.<43-character-secret>. X-Client-Id carries the public app_<uuid> identifier. Do not reconstruct the token from the displayed safe prefix. The raw secret is never retrievable again. Keep it in server environment variables or protected configuration, never browser JavaScript, mobile binaries, client-downloaded plugins, URLs, chat, analytics or public repositories. Do not use NEXT_PUBLIC_* variables. Rotate before credential expiry. Rotation can shorten an old credential's remaining lifetime using an overlap of zero to 86400 seconds, default 3600 seconds; revocation can be immediate.

The /api/v1 prefix uses application authentication, not Clerk cookies. It rejects Origin-bearing requests, does not provide browser CORS access and has no cookie authentication fallback. This does not remove ordinary Clerk and Origin protections from developer settings, consent or admin APIs. Send application/json on external non-GET requests. All responses disable caching. The request-body bound is 16384 bytes. APP_API_ENABLED must explicitly be true on the SSG server, APP_LINK_HASH_KEY must be a protected 32-or-more-character server key, and APP_ORIGIN must be the public HTTPS origin for usable linking URLs. Never share those server secrets with applications.

Scopes are independent. profile permits the app-scoped identity and display name. balance:read permits available cash, which is informational and not reserved. balance:debit permits spending without implicitly granting balance visibility. balance:credit permits reviewed minting when mint mode is approved. Effective permissions intersect app approval, live credential policy and current consent. Grant IDs are not bearer credentials. Applications see pairwise app_user_id values rather than Clerk IDs or email addresses.

The same grant.limits object caps both debits and minted credits, with separate gross usage counters for the two directions. Current default ceilings are per_operation_cents 100000, daily_cents 500000 and lifetime_cents 5000000, corresponding to 1000, 5000 and 50000 simulation dollars. The default app-wide daily gross debit-plus-mint ceiling is 5000000 cents. A fresh draft has no approved scopes and all mint limits zero. Admin approval supplies explicit caps; consent can lower them. Platform defaults still cap effective per-user debit/mint limits even if an app policy is higher. The schema's maximum configurable amount is 100000000 cents, not a promise that any transaction that large is allowed. Day buckets are UTC. Refunds do not restore gross spend budgets. App-per-user daily/lifetime counters also span reconsent, so linking again does not reset those counters.

Four-word requests last ten minutes. Confirmation previews last at most two minutes and never beyond the link expiry. Consent and newly issued credentials last ninety days. Expiry is enforced by authorization checks, not delayed database TTL cleanup. Metadata or approval-policy changes invalidate earlier consent by policy version; new permissions and higher limits require consent again. A revoked grant blocks new debits immediately. Linked grants may be lowered or revoked in Connected apps.

POST /api/v1/link-requests accepts user_code, scopes and optional external_subject. user_code may be omitted for SSG-generated words. If supplied, generate four independent uniformly random words from the English BIP39 2048-word list using a cryptographic RNG. SSG normalizes case and whitespace. external_subject is a bounded app-controlled plain-text label, not a global identity attestation.

```json
{
  "user_code": "abandon ability able about",
  "scopes": ["balance:debit"],
  "external_subject": "cs2:example-server:76561198000000001"
}
```

Those words illustrate formatting only. Never reuse them. A 201 response contains request_id, device_token, user_code, verification_uri, expires_at and interval_seconds, currently five. Show words privately to the verified player, not public chat. Keep the unrelated 43-character device token on the trusted backend. The user visits verification_uri, signs in, previews the application and external account, chooses scopes/limits and explicitly authorizes. Neither opening /link nor previewing words authorizes spending. Warn against entering unsolicited codes.

POST /api/v1/link-requests/{request_id}/poll takes a JSON object with device_token. Respect interval_seconds and any Retry-After header. The state is authorization_pending, approved, denied or expired. Approved results add grant_id, app_user_id and granted_scopes, with display_name only when authorized. Approval can be polled again until link expiry to recover a lost response. Persist external-account bindings only after checking approved state, required granted scope and the server's original external-account identity. Bindings belong to this app, not a platform-wide Steam ownership proof.

Link creation permits ten registrations per app per minute, one thousand per day and one hundred simultaneously pending requests. Polling permits one poll per request per five seconds and three hundred per app per minute. Signed-in human previews permit five per user per minute, twenty per source per minute and one hundred per user per day. Additional external-call and money-operation throttles are six hundred and three hundred per app per minute respectively. Throttles are distributed database counters. 429 can include Retry-After and retry_after_seconds; slow_down specifically means polling too quickly. These are implementation defaults, not throughput guarantees.

GET /api/v1/users returns items and next_cursor. Each item contains app_user_id, grant_id, scopes and active status; display_name appears only with profile permission. limit defaults to fifty, maximum one hundred. Supply the returned next_cursor as cursor until null. This enumerates this app's active grants, never the SSG user directory. GET /api/v1/users/{app_user_id} requires profile and returns app_user_id, grant_id, display_name and granted_scopes. GET /api/v1/users/{app_user_id}/balance requires balance:read and returns available_cents, unit ssg_cent, observed_at and room_version.

POST /api/v1/users/{app_user_id}/debits requires an Idempotency-Key header and a positive safe-integer amount_cents. Never use fractional cents, negative shortcuts or client-supplied prices. description and external_reference are bounded plain text, maximum 160 characters, with a nonempty external_reference. Reject control characters and markup.

```json
{
  "amount_cents": 70000,
  "description": "CS2 custom buy deagle",
  "external_reference": "server-instance.purchase-uuid"
}
```

A committed response contains transaction_id, app_user_id, grant_id, status committed, amount_cents, direction debit, external_reference, description and created_at. available_cents is included only when current balance:read consent permits it. It is current cash at response time, not a historical before/after balance. A fresh commit returns 201; identical replay returns 200 with Idempotency-Replayed true. Replays do not consume budget twice.

Keys must contain eight to 128 ASCII letters, digits, dots, underscores, colons or hyphens. They are unique per application across both money endpoints and bound to the user, consent generation and business payload, including descriptions and refund references. Store the complete original payload and key durably before sending. Do not change them during a retry, across restarts or after a timeout. A changed payload or consent generation can produce idempotency_conflict. Ledger records persist independently of the room's short-lived receipts.

GET /api/v1/transactions/{transaction_id} and GET /api/v1/transactions/by-key/{idempotency_key} return the application's canonical committed receipt. A timeout, aborted request, 503 or broken response is ambiguous. Query by the original key; if no committed record is visible, retry the identical operation with that same key. A 404 alone is not proof that a concurrent request cannot still commit. Never issue a replacement key or grant an item on uncertainty. Historical lookup remains available to suspended apps with a still-valid credential, but suspension blocks new money movement. Revoked or expired credentials cannot reconcile; restore approved credential access through the owner/admin process. Grant revocation can redact balance/profile data without erasing app-scoped receipts.

POST /api/v1/users/{app_user_id}/credits uses the same fields and idempotency rules. A compensation refund adds credit_reason refund and original_transaction_id. It can return at most the unrefunded amount of this app's own original debit to its original user, including partial refunds. Concurrent refunds reserve their combined total transactionally. It requires the app and credential's debit approval, not arbitrary mint permission. Refunds are bounded by the original debit and its ninety-day window, not the ordinary credit/mint cap. The current refund window is ninety days from the original debit. Refunds can compensate a revoked/expired grant, but the app must remain approved, the credential live, and the original user must remain approved and not access-revoked. Suspension, maintenance or revoked credentials can therefore leave a compensation pending for operator resolution. Do not promise unconditional refunds.

```json
{
  "amount_cents": 70000,
  "description": "CS2 undelivered deagle refund",
  "external_reference": "server-instance.purchase-uuid",
  "credit_reason": "refund",
  "original_transaction_id": "11111111-1111-4111-8111-111111111111"
}
```

A mint adds credit_reason mint and no original_transaction_id. It requires balance:credit consent, app mint approval and all current app/user/mint budgets. It is issuance, not a refund loophole. Financial mutation and durable receipt commit together in replica-set Mongo transactions with room version CAS, approval/grant/credential fences and conserved issuance adjustments. No standalone Mongo fallback is supported. No external game delivery occurs inside those transactions.

External errors have an error object with code, message and request_id, optionally retry_after_seconds. Codes include invalid_request, invalid_client, insufficient_scope, app_suspended, unavailable, insufficient_funds, limit_exceeded, idempotency_conflict, rate_limited, slow_down and temporarily_unavailable. Typical statuses are 400 for bad input, 401 for credentials, 403 for permissions/suspension, 404 for unavailable resources, 409 for funds/limits/conflicts, 415 for content type, 429 for throttles and 503 for service/transaction failures. Do not derive authorization from a human-readable message.

Developer browser routes use normal signed-in authentication. GET/POST /api/developer/apps list/register apps; GET/PATCH /api/developer/apps/{app_id} view/edit one; POST /api/developer/apps/{app_id}/credentials creates a one-time secret; DELETE /api/developer/apps/{app_id}/credentials/{credential_id} revokes it. Registration takes name, description and HTTPS website. PATCH can edit metadata or request pending/deleted status. GET /api/admin/apps and GET/PATCH /api/admin/apps/{app_id} are admin-only; approval specifies status, approved_scopes, limits and app_daily_cents, with optional credit_mode and mint_limits. Browser errors use the existing string error envelope, not the external structured envelope.

GET /api/app-links lists the signed-in user's connected grants. POST /api/app-links/preview takes user_code and returns confirmation_token, application identity including app.credit_mode, requested_scopes, external_subject, expires_at, limits and refund_after_revoke. POST /api/app-links/authorize takes confirmation_token, selected scopes and the complete limits object. PATCH /api/app-links/{grant_id} accepts complete reduced limits and optional reduced scopes. DELETE revokes it. Send JSON, including an empty object where needed on browser DELETE. Browser write requests require ordinary CSRF/Origin protections. Money API credentials do not authorize these browser actions.

The executable trusted-server example is in examples/cs2. It implements the HTTP client, SQLite purchase outbox, game-thread adapter contract and isolated tests. It does not include a compiled CounterStrikeSharp plugin, an engine buy-menu replacement, webhooks or reservation/capture. See examples/cs2/README.md for its crash boundaries, safety requirements and test command.
