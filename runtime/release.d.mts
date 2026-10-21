export const RELEASE_EVENT: "release:version";
export function releaseId(payload: unknown): string|null;
export function createReleaseObserver(clientRelease:string,onMismatch:(release:string)=>void):(payload:unknown)=>void;
export function serveRelease(request:import("node:http").IncomingMessage,response:import("node:http").ServerResponse,release:string):boolean;
export function attachReleaseHandshake(io:import("socket.io").Server,release:string):void;
