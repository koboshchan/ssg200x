export const ISOLATED_QA_CHAT_ROOM:'qa-isolated';
export const DEFAULT_CHAT_ROOMS:readonly string[];
export function isolatedQaChatRoomEnabled(env?:Record<string,string|undefined>):boolean;
export function chatRoomIds(env?:Record<string,string|undefined>):string[];
