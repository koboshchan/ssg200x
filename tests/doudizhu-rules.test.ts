import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classify,beats,rank,shuffled} from "../lib/doudizhu-rules";

// Rank-only fixtures allocate distinct suits, so invalid-card checks stay real.
function cards(spec:string):string[]{
 const used=new Map<string,number>();
 return spec.split(/\s+/).filter(Boolean).flatMap(token=>{
  return [...token].map(r=>{
   if(r==="X"||r==="Y") return r;
   const i=used.get(r)??0;used.set(r,i+1);
   return r+"shdc"[i];
  });
 });
}
function expect(spec:string,kind:string,r:number,length=1){
 const hand=cards(spec),before=[...hand],actual=classify(hand);
 assert.deepEqual(actual,{kind,rank:r,length,size:hand.length},spec);
 assert.deepEqual(classify([...hand].reverse()),actual,"order independence: "+spec);
 assert.deepEqual(hand,before,"input unchanged");
 return actual!;
}
test("card ordering and strict canonical poker notation",()=>{
 for(const [i,r] of [..."3456789TJQKA2"].entries())
  for(const suit of "shdc") assert.equal(rank(r+suit),i+3);
 assert.equal(rank("X"),16);assert.equal(rank("Y"),17);
 for(const bad of ["","10s","3S","xs","Xs","J","joker","as","3x","XX"," 3s","3s "])
  assert.equal(rank(bad),-1,bad);
});
test("all basic plays and attachment ranks",()=>{
 expect("3","single",3);expect("Y","single",17);expect("22","pair",15);
 expect("AAA","triple",14);expect("222 X","triple-single",15);
 expect("333 AA","triple-pair",3);expect("2222","bomb",15);
 expect("XY","rocket",17);expect("777 2","triple-single",7);
});
test("all sequences terminate at ace and obey minimum lengths",()=>{
 expect("34567","straight",7,5);expect("TJQKA","straight",14,5);
 expect("3456789TJQKA","straight",14,12);
 expect("334455","pair-straight",5,3);expect("QQKKAA","pair-straight",14,3);
 expect("333444","airplane",4,2);expect("QQQKKKAAA","airplane",14,3);
 for(const bad of ["3456","3344","JQKA2","QKA23","QQKKAA22","KKKAAA222",
 "34568","334466","333555","A2345"]) assert.equal(classify(cards(bad)),null,bad);
});
test("airplanes with singles, pairs and paired single wings",()=>{
 expect("333444 89","airplane-single",4,2);
 expect("333444 99","airplane-single",4,2);
 expect("333444 2X","airplane-single",4,2);
 expect("333444 88JJ","airplane-pair",4,2);
 expect("KKKAAA 2233","airplane-pair",14,2);
 expect("333444555 789","airplane-single",5,3);
 expect("333444555 667788","airplane-pair",5,3);
 expect("333444555666 789T","airplane-single",6,4);
 expect("333444555666 778899TT","airplane-pair",6,4);
});
test("airplane ambiguity prefers full pure chain then highest valid core",()=>{
 expect("333444555666","airplane",6,4);
 // One triple can provide three same-ranked single wings.
 expect("333444555 999","airplane-single",5,3);
 expect("333444555666 7777","airplane-single",6,4);
});
test("wings cannot include core ranks, mixed pairs, repeated pair ranks or rocket",()=>{
 for(const bad of ["33334445","333444 XY","333444 566","333444 5556",
 "333444 5555","333444555 667789","333444555666 77778888",
 "KKKAAA222 456","3334445","333444 55X","333444555 7XY"])
  assert.equal(classify(cards(bad)),null,bad);
});
test("quad attachments are ordinary combos with distinct wing ranks",()=>{
 expect("3333 45","four-single",3);expect("AAAA 2X","four-single",14);
 expect("2222 3344","four-pair",15);
 for(const bad of ["3333 44","3333 XY","3333 4444","3333 4456","3333 4",
 "33334444 56","3333 445"]) assert.equal(classify(cards(bad)),null,bad);
});
test("invalid and duplicated physical cards reject without throwing",()=>{
 for(const hand of [[],["3s","3s"],["X","X"],["Y","Y"],["3s","?"],["10s"],
 ["3s","3h","3d","3c","3s"],shuffled().slice(0,21)])
  assert.equal(classify(hand),null,JSON.stringify(hand));
 assert.equal(classify(null as unknown as string[]),null);
 assert.equal(classify([null] as unknown as string[]),null);
});
test("beats compares only equal shapes, size and core rank; bombs and rocket override",()=>{
 const parse=(s:string)=>{const c=classify(cards(s));assert.ok(c,s);return c;};
 for(const [low,high] of [["3","4"],["X","Y"],["33","44"],["333","444"],
 ["333 A","444 2"],["333 AA","444 22"],["34567","45678"],
 ["334455","445566"],["333444","444555"],["333444 89","444555 33"],
 ["333444 8899","444555 6677"],["3333 45","4444 23"],["3333 4455","4444 2233"],
 ["3333","4444"]]){
  assert.equal(beats(parse(high),parse(low)),true,high+" > "+low);
  assert.equal(beats(parse(low),parse(high)),false,low+" < "+high);
  assert.equal(beats(parse(low),parse(low)),false,"tie");
 }
 for(const [a,b] of [["345678","45678"],["333444","333444 56"],
 ["333 A","333 AA"],["3333 45","4444 2233"],["33","4"]]){
  assert.equal(beats(parse(a),parse(b)),false);
  assert.equal(beats(parse(b),parse(a)),false);
 }
 const ordinary=["Y","22","222","222 X","222 AA","TJQKA","QQKKAA","KKKAAA",
 "KKKAAA 23","KKKAAA 2233","2222 34","2222 3344"];
 for(const s of ordinary){
  assert.equal(beats(parse("3333"),parse(s)),true,s);
  assert.equal(beats(parse(s),parse("3333")),false,s);
 }
 for(const s of [...ordinary,"2222"]){
  assert.equal(beats(parse("XY"),parse(s)),true);
  assert.equal(beats(parse(s),parse("XY")),false);
 }
 assert.equal(beats(parse("XY"),parse("XY")),false);
});
test("fresh crypto shuffled decks contain exactly all 54 cards",()=>{
 const expected=[..."3456789TJQKA2"].flatMap(r=>[..."shdc"].map(s=>r+s)).concat(["X","Y"]).sort();
 const orders=new Set<string>();
 for(let i=0;i<64;i++){
  const deck=shuffled();assert.equal(deck.length,54);assert.equal(new Set(deck).size,54);
  assert.deepEqual([...deck].sort(),expected);orders.add(deck.join(","));
  const untouched=shuffled();deck[0]="changed";assert.ok(!untouched.includes("changed"));
 }
 assert.ok(orders.size>1);
 const source=readFileSync("lib/doudizhu-rules.ts","utf8");
 assert.doesNotMatch(source,/Math\.random/);assert.match(source,/crypto\.getRandomValues/);
});
test("all rank/suit pairs and all triples/quads classify correctly",()=>{
 for(const r of "3456789TJQKA2"){
  for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)
   assert.equal(classify([r+"shdc"[a],r+"shdc"[b]])?.kind,"pair");
  for(let omit=0;omit<4;omit++)
   assert.equal(classify([..."shdc"].filter((_,i)=>i!==omit).map(s=>r+s))?.kind,"triple");
  assert.equal(classify([..."shdc"].map(s=>r+s))?.kind,"bomb");
 }
});
