# Live socket credential renewal

The old server disconnected every socket at the original Clerk JWT's exp, even
while its underlying session remained active. The browser only fetched a new
token after disconnecting. The explicit server disconnect then incurred the
client's one-second retry delay plus token fetching and initial state loading.
This is a deterministic periodic interruption shared by TableTalk and every
other live stream, not a missing heartbeat.

The server now requests a fresh token 20 seconds before its verified deadline,
retrying every five seconds. The browser forces a Clerk token refresh and sends
it on the existing socket. Server verification enforces the same user and
session, authorized origin, a newer future expiration, and the existing live
session/identity guard. Expiration stays armed during verification. Invalid,
stale, missing, revoked, or late credentials never extend access. Tab leases,
state sequences, chat handlers, and the transport are not replaced.

Engine.IO already supplied 25-second ping / 20-second pong timeout defaults;
those existing values are now explicit, not a new heartbeat implementation.

## Observation limits

A six-minute read-only production probe on October 20, 2026 confirmed handshake
pingInterval=25000 and pingTimeout=20000 and observed server ping packets.
Without a signed-in session, namespace authentication was rejected; these
unauthenticated Engine.IO connections closed around 45 seconds (code 1005).
Those closes are NOT evidence of the user's authenticated two-minute symptom
or of a proxy timeout. Do not infer an authenticated transport lifetime from
this probe. A fresh desktop SSH read-only attempt timed out before any command
ran, so proxy configuration was not rechecked. Earlier separate inspection
recorded nginx websocket upgrade forwarding with 512-second timeouts.

The expiry defect is proven from server/client code and reproduced in real
Socket.IO regression tests. Attribution of every reported production hang to
this defect still requires an authenticated trace or post-deployment
verification; this change was pushed only, not deployed.

## Validation

Real Socket.IO test maintains one socket ID across three credential renewals
past the initial deadline, verifies ACK traffic, then verifies revocation
causes expiration. Negative tests cover other users/sessions, expired/malformed/
stale tokens, signature failures, late verification and disposed clients.
Mounted Chromium provider test checks fresh-token renewal without reconnecting.
Full suite: 582 tests, 581 passed, one skipped, zero failures.
TypeScript and production Next build pass in Kat's sandbox.
