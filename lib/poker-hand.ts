import solver from "pokersolver";

import {isBlack78} from "./black78";
export {isBlack78} from "./black78";

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
