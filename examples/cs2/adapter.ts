import type { GameAdapter, PlayerSession } from "./outbox";

// The C# bridge must implement this interface on the installed CSSharp build.
// Only plain strings cross the async boundary, never native event/controller handles.
export interface GameThreadBridge {
  // This promise resolves only after one synchronous callback completes on the game thread.
  // Rejection, cancellation or a scheduling timeout is ambiguous, not known-no-delivery.
  runOnGameThread<T>(callback: () => T): Promise<T>;
  currentAuthorizedSession(steamId64: string): PlayerSession | null;
  eligibleForDeagle(steamId64: string): boolean;
  // Called in the SAME callback as identity and eligibility checks.
  // Return delivered only after verified item creation. Any uncertain native result is unknown.
  giveDeagle(steamId64: string): "delivered" | "unknown";
}
export function gameAdapter(bridge: GameThreadBridge): GameAdapter {
  return {
    async deliverOnGameThread(expected) {
      try {
        return await bridge.runOnGameThread(() => {
          const current = bridge.currentAuthorizedSession(expected.steamId64);
          if (!current || current.steamId64 !== expected.steamId64 ||
              current.connectionId !== expected.connectionId ||
              current.pawnGeneration !== expected.pawnGeneration ||
              current.mapGeneration !== expected.mapGeneration ||
              !bridge.eligibleForDeagle(expected.steamId64)) return "not_delivered";
          return bridge.giveDeagle(expected.steamId64);
        });
      } catch {
        return "unknown";
      }
    },
  };
}
