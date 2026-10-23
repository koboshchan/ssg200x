import type {Position} from "../lib/finance";
export function pnl(p:Position,mark:number): number;
export function liqPrice(p:Position): number;
export function liquidatable(p:Position,mark:number): boolean;
export function netPnl(p:Position,mark:number): number;
export function equity(p:Position,mark:number): number;
