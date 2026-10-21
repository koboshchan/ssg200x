import type {IdleAnchor,LaunchParams} from './roulette-physics.mjs';
export type SolveInput={target:number;anchor:IdleAnchor;spinStartAt:number;seed:number;maxTries?:number};
export type SolveResult={launchParams:LaunchParams;durationMs:number;endAnchor:IdleAnchor;tries:number;solveMs:number};
export function solveLaunch(input:SolveInput):SolveResult;

export const MAX_SOLVER_TRIES:number,MAX_SOLVE_MS:number;
