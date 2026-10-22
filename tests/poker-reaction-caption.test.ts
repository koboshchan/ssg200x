import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('reaction toggle stays in table caption with no idle hint band',()=>{
 const room=readFileSync('app/room-client.tsx','utf8');
 const taunts=readFileSync('app/poker-taunts.tsx','utf8');
 const caption=room.slice(room.indexOf('<div className="table-caption">'),room.indexOf('<PokerPlayerMenu'));
 assert.match(caption,/<PokerTauntControls[^>]*\/><\/div>$/);
 assert.doesNotMatch(taunts,/Click your seat for free emotes\.|Emotes are free\. Throws charge your wallet and go to the house\./);
 assert.match(taunts,/muted\?"Show reactions":"Hide reactions"/);
 assert.match(taunts,/t\.error\?<small role="status">/);
 assert.match(taunts,/Retry unconfirmed throw/);
});
