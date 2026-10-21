import type {IdleAnchor,LaunchParams} from './roulette-physics.mjs';
export type SolveInput={target:number;anchor:IdleAnchor;spinStartAt:number;seed:number;maxTries?:number};
export type SolveResult={launchParams:LaunchParams;durationMs:number;endAnchor:IdleAnchor;tries:number};
export function solveLaunch(input:SolveInput):SolveResult;
