# Authentication and privacy inventory

Scope is source audit plus isolated mocked-Clerk and real cryptography regression tests, not production sign-in testing. No deployment performed.

| Surface | Authentication/authorization | Data boundary |
| --- | --- | --- |
| /blackjack | Clerk session server-side middleware | No account object passed as page props |
| /markets | Clerk session server-side middleware | No account object passed as page props |
| / | Public by design | No account object passed as page props |
| /players | Clerk session + privateMetadata.admin === true | No account object passed as page props |
| /poker | Clerk session server-side middleware | No account object passed as page props |
| /roulette | Clerk session server-side middleware | No account object passed as page props |
| /settings | Clerk session server-side middleware | No account object passed as page props |
| /standings | Clerk session server-side middleware | No account object passed as page props |
| /wallet | Clerk session server-side middleware | No account object passed as page props |
| /leaderboard | Public by design | Name, initials avatar, net worth only |
| /privacy | Public by design | No account object passed as page props |
| /terms | Public by design | No account object passed as page props |
| /api/action | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/admin | endpoint Clerk auth/currentUser; privateMetadata.admin === true | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/airdrops | endpoint Clerk auth/currentUser; privateMetadata.admin === true | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/blackjack | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/candles | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/finance | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/internal-live | Per-process timing-safe secret; never accepts a public caller identity | Trusted socket identity supplied by this process only |
| /api/maintenance | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/room | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/roulette | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/settings | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| /api/transfers | endpoint Clerk auth/currentUser | Caller session identity owns mutations; admin actions use opaque publicId |
| WebSocket handshake | Origin + verified Clerk token + server user lookup | Identity never taken from client userId/admin |
| state:resync | Authenticated connection; expiry/revocation enforced before next snapshot | Connection-local baseline only |
| candles:subscribe | Authenticated connection; expiry/revocation enforced before next snapshot | Validated chart selection only |
| chat:register/state/claim/wrap/send/history/keys:get/keys:put | Active Clerk session plus room membership; actor ID comes from socket | Device/signature/recipient ownership checks; own encrypted backup only |
| /internal-airdrop | Timing-safe per-process secret | Validated opaque receipt ID, no account payload |

## Findings and resolution

Fixed: private pages previously relied on client hiding/redirects; /players lacked a server admin gate. Server middleware now rejects before rendering, including RSC requests. Authentication-unconfigured private pages now fail closed.

Fixed: administrator room snapshots exposed member email addresses in adminUsers and members. Both fields and the matching UI were removed. Opaque publicIds remain necessary for game ownership and admin targeting; no Clerk IDs are present in ordinary room DTOs. Admin portfolio access remains intentional and server-gated.

Fixed: live snapshots kept handshake-time admin privileges until token expiration. A bounded ten-second active-session/user refresh now precedes snapshots and chat operations. Revoked sessions disconnect; admin removal updates identity. No snapshot is emitted when the refresh fails.

Existing controls verified: all external APIs use the shared Clerk endpoint; privateMetadata.admin must be literal true, not public/unsafe metadata. Write origin and strict schemas prevent client-injected user identity. Position, transfer, wager, settings and device ownership are session-derived. Public leaderboard returns only display name, initials and net worth, not account records.

Unresolved migration requirement: legacy E2EE chat embeds Clerk IDs in signed data, AES-GCM AAD and key-wrap HKDF. Replacing those fields destroys history verification/decryption. See chat-identity-privacy.md and real WebCrypto regression tests. No destructive reset or silent history loss performed. Public cryptographic device keys are inherently necessary for peer encryption; private keys and recovery backup are not returned to other users.

Fixed after integration: parallel display-name work used email local-part as fallback, leaking private email information without @. Removed every email fallback; missing fullName, firstName and username now yield Player. Regression tests explicitly require no email-derived labels.

No Clerk keys were used in builds. Tests use explicit fake keys and mocked Clerk I/O only. No production or Windows resources were touched.

## Verification

The new page-denial and privacy/session tests were run against the old implementations first: two auth tests and two privacy tests failed. With fixes all pass. TypeScript passes. After rebasing onto the concurrent release-fixture fixes, the full suite passes with one existing skipped integration prerequisite.
