// One pure implementation is imported unchanged by browser, Node worker and tests.
// .mjs keeps worker_threads independent of Next/TypeScript runtime loaders.
export {PHYS_VERSION,POCKETS,STEP,TAU,idleRate,idleV,idleW,createTrajectory,validateRound,poseAt,pocketAtRest} from '../runtime/roulette-physics.mjs';
export type {IdleAnchor,LaunchParams,PhysicsRound,Trajectory,Pose} from '../runtime/roulette-physics.mjs';
