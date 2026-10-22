import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

// Root cause of "The server didn't answer in time.": the client emitted bare
// names such as "keys:get" while server.mjs only listens on "chat:keys:get",
// so no ack was ever sent and every request hit the 15s socket timeout.
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("every chat request event reaches a registered server handler",()=>{
 const client=read("lib/chat-client.ts"),dock=read("app/chat-dock.tsx"),server=read("server.mjs");
 const requested=new Set([...client.matchAll(/this\.request\("([a-z:]+)"/g)].map(m=>m[1]));
 assert.ok(requested.size>=7,"expected the client to request chat events");
 const list=server.match(/for\(const event of \[([^\]]+)\]\)\{\s*socket\.on\("chat:"\+event/);
 assert.ok(list,"server registers chat handlers with chat: prefix");
 const handled=new Set([...list[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]));
 // Follow the transport implementation, whether the dock owns it or delegates
 // to a client wrapper. Do not couple this contract to constructor formatting.
 const transportSources=[dock,client];
 const prefix=transportSources.some(source=>/\.request\("chat:"\+event,/.test(source));
 assert.ok(prefix,"group chat transport must prefix events with chat:");
 for(const e of requested)assert.ok(handled.has(e),e+" has no chat: server handler");
});
