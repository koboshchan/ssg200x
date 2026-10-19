import { MongoClient, MongoServerError } from "mongodb";
import type { Room } from "./types";
import { freshRoom } from "./poker";
let connection: Promise<MongoClient> | undefined;
export async function db() {
 const uri = process.env.MONGODB_URI;
 if (!uri) throw new Error("MONGODB_URI required");
 connection ??= new MongoClient(uri,{maxPoolSize:20,serverSelectionTimeoutMS:5000}).connect().catch(e=>{connection=undefined;throw e;});
 return (await connection).db(process.env.MONGODB_DB || "pokerroom");
}
export async function rooms() { return (await db()).collection<Room>("rooms"); }
export async function readRoom() {
 const c = await rooms();
 await c.updateOne({_id:"main"},{$setOnInsert:freshRoom()},{upsert:true}).catch(e=>{if(!(e instanceof MongoServerError && e.code===11000))throw e;});
 return (await c.findOne({_id:"main"}))!;
}
export async function closeDatabase() { if(connection)await(await connection).close();connection=undefined; }
