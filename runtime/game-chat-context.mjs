// Routing names are signed into every existing v1 wrap/message envelope.
// Validation alone never grants access. A server-owned context resolver must authorize game rooms.
export function validChatRoom(room){
 return typeof room==='string' && (['main','poker-02','poker-03'].includes(room) ||
 /^game-(?:(?:poker|blackjack)-0[123]|roulette-01|(?:ddz|pool)-[A-Za-z0-9_-]{1,64})$/.test(room));
}
export function gameChatRoom(kind,id){
 const room='game-'+kind+'-'+id;
 if(!validChatRoom(room)||!room.startsWith('game-'))throw Error('Invalid game chat context');
 return room;
}
