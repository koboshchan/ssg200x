# Server-locked roulette physics

The top-down wood renderer uses the real app component. The v2 bowl simulation
uses one 16ms semi-implicit step and one contact projection, without adaptive
substeps or impact bisection. Rounded diamond height fields preserve horizontal
forward momentum; vertical falls are not reflected sideways.
The executable shared physics lives in runtime/roulette-physics.mjs, re-exported by
lib/roulette-physics.ts. A .mjs module lets worker_threads and the browser consume
the exact same equations without runtime TypeScript compilation. PHYS_VERSION is
the SHA-256 prefix of that entire module with its hash replaced by PHYSICS_HASH;
a unit test verifies it.

## Atomic ordering and recovery

At 55 seconds, tickRoulette first commits a pending lock through the existing room
CAS. All bet/change/cancel/rebet actions reject pending rounds. Only after that
commit does a separate CAS draw and persist the target. Pending metadata never
crosses roulettePublic. CAS contenders reuse the committed target. After restart,
a pending round resumes solving that same target.

A worker_thread searches d, dvk, dwb using the actual continuous idle anchor and
the proposed future start. No production search runs on the main event loop.
If preparation misses its start window, it solves again at a new future start,
never shifts an already-solved trajectory. A final round-id CAS publishes the
physics contract and settles escrow once. Other contenders cannot publish twice.
The next betting round opens only after actual launch delay, physical settling,
700ms riding, and the existing five-second result pause.

The public post-lock contract carries roundId, target, physicsVersion,
lockDeadline, resultGeneratedAt, broadcastAt, spinStartAt, serverNow,
idleAnchor {atMs, phase, vel, slot, rel, r}, and launchParams {d, dvk, dwb}.
No seed is necessary on the client. Seeds exist only in post-lock worker input.
Initial anchors contain no result. Previous rounds carry the exact rest angle
and radius, not the pocket centre.

## Playback

The client validates ordering/version/params before executing one simulation.
Missing params fail closed, never trigger search or an analytic target fallback.
There are no label offsets, phase corrections, target lerps or post-sim rotations.
Fixed labels are drawn in the original European order. Timestamp sampling seeks
the same recorded trajectory for live playback, reconnects and late joins.

At launch, wheel phase/velocity come from idleW/idleV at spinStartAt+d and ball
position comes from the carried rel/r. After rest plus 700ms the wheel switches
continuously in phase and velocity to the same analytic idleW/idleV on both sides,
with a four-second damping constant tending to three degrees per second. Reduced
motion keeps the displayed wheel at idle speed, fades the ball at launch, and
crossfades into the physical capture. The physical trajectory/result are unchanged.
The preference is read before the first canvas draw, including mid-spin joins.

The old analytic wheelPose is retained for legacy fixtures only. Production UI
does not use it and old in-flight spins lacking the new contract fail closed
until the next physical round. Existing chips, limits, payouts and audits remain
unchanged.

## Verification

tests/roulette-physics.test.ts launches all 37 labels in chained rounds with
carried phase, velocity, relative ball angle and radius; compares independent
client simulations at 25/50/90 percent; verifies launch and idle handoff
continuity; checks non-blocking worker progress; rejects pre-lock/version/params
violations; tests pending privacy and prepared settlement/escrow conservation.
