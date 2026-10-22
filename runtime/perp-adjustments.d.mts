import type {Position} from "../lib/finance";
export function positionSlice(p:Position,percentBps:number):{slice:Position;remainder:Position};
export function increasedEntry(p:Pick<Position,"margin"|"entry"|"side">,addedMargin:number,mark:number):number;
