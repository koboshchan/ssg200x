import solver from "pokersolver";

/** Hole cards only. Never infer the house hand from the combined seven cards. */
export function isBlack78(hole: readonly string[]) {
 return hole.length === 2 && hole.every(card => /^[78][sc]$/.test(card)) &&
  hole[0][0] !== hole[1][0];
}

/** Called only after the server filters folded players and side-pot eligibility.
 * Keep ordinary pokersolver ranking/ties intact; Black 78 has no board kicker.
 * Return indexes, not solver objects or a new persisted/wire score encoding.
 */
export function showdownWinners(holes: readonly (readonly string[])[], board: readonly string[]) {
 const special = holes.flatMap((hole,index) => isBlack78(hole) ? [{index,description:"Black 78"}] : []);
 if (special.length) return special;
 const hands = holes.map(hole => solver.Hand.solve([...hole,...board]));
 const winners = solver.Hand.winners(hands);
 return hands.flatMap((hand,index) => winners.includes(hand) ? [{index,description:hand.descr}] : []);
}
