# Per-game chat fixture demo

This is an isolated demo, not the production app. No production environment, Clerk account, existing chat key, recovery words or game wallet is read. The only accounts are alice and bob, using disposable fixture metadata in a database named fakebucks_test_game_chats_a06ab046.

Run npm ci, bundle entry.ts with esbuild to public/bundle.js, start a sandbox-local MongoDB on loopback port 43892, then run node demos/game-chats/server.mjs. The HTTP/socket server listens on 43891. Never expose MongoDB.

Open two browsers with ?user=alice and ?user=bob. Initialize each fixture identity once in Global. First entering a game creates its fixture room; that entrant is the room creator. Joining the same room triggers the existing ChatClient key-share flow. The creator device generates the AES-GCM epoch; authenticated ECDH/HKDF wraps distribute it. The server receives ciphertext and public metadata only. Disconnect every keyholder and an unwrapped joiner waits with sending disabled.

The selector covers three poker tables, three blackjack tables, roulette, and two sample DDZ and pool rooms. Watching DDZ/pool joins the same chat as the players. Changing context automatically selects Game without a reload or extra socket. Global remains selectable. The DM tab deliberately points back to the existing app; this prototype does not replace or reimplement DMs. Other minigames have no context selector or chat.

Closing a DDZ/pool fixture room removes it from both clients and denies subsequent state, keys, history and send requests. There is no archive selector or history archive API. Closure does not assert secure erasure of ciphertext already on disk or peers' devices.

The shared service changes are opt-in. Existing main, poker-02 and poker-03 names and signatures remain valid, with their original membership fingerprints. New game names require a server-owned context resolver, approved global membership, contextual membership and an open room. Client route names alone never grant access. Production socket dispatch and app navigation are unchanged in this demo branch.

Before integration, the main app needs server-authoritative context adapters for actual tables and DDZ/pool lifecycle, socket context subscription and ChatDock wiring. Pool must use its owner worker's actual room identity. Actual production Clerk authorization, restored-data acceptance, full app navigation and game-wager acceptance remain untested and must pass the existing integration gate before any push or deployment. This demo does not qualify as that acceptance.

Tests use a separate fakebucks_test_* database. game-chat-scope.test.ts exercises all namespaces with real Mongo and WebCrypto, peer unwrap/decrypt, forged cross-room envelopes, waiting without a grant, creator claims, closed contexts, outsiders and unchanged global/legacy history.

Presence in this fixture follows the server's current context per socket. Leaving or disconnecting the last socket for an account removes that account from the roster; revocation rotates the next epoch. Previously downloaded plaintext and epoch keys cannot be retracted. Creator-only bootstrap intentionally waits for the original creator if membership rotation occurs while that creator is offline.

Context fencing is serialized in this one fixture process. It is not an atomic cross-process global-revocation guarantee. App integration must fence all real game roster writers and global approval changes together, rather than copy the fixture resolver as a production concurrency design.
