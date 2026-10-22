export function normalizeCommit(value:unknown):string;
export function commitStatus(client:unknown,server:unknown):string;
export function serveCommit(request:import("node:http").IncomingMessage,response:import("node:http").ServerResponse,commit:unknown):boolean;
