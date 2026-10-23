import {test} from "node:test";
import assert from "node:assert/strict";
import {rouletteRequestSchema} from "../lib/roulette-request";

const captured={
 bet:{amount:100,kind:"red"},requestAt:1792736547857,
 requestId:"ceb8e626-fa8a-49dd-a4db-c9bf60cc4d16",
 round:3802,tableId:"01",type:"bet",
};
test("exact captured browser red bet accepts bounded shared table context",()=>{
 assert.deepEqual(rouletteRequestSchema.parse(captured),captured);
 for(const tableId of ["01","02","03"]){
  assert.equal(rouletteRequestSchema.safeParse({...captured,tableId}).success,true);
 }
 const {tableId,...legacy}=captured;
 assert.deepEqual(rouletteRequestSchema.parse(legacy),legacy);
});
test("all roulette action variants accept shared table context and retain strict shapes",()=>{
 for(const tableId of ["01","02","03"]){
  const {bet,type,...base}=captured;
  for(const action of [
   {type:"bet",bet},
   {type:"rebet"},
   {type:"change",betId:captured.requestId,bet},
   {type:"cancel",betId:captured.requestId},
  ]){
   assert.equal(rouletteRequestSchema.safeParse({...base,tableId,...action}).success,true);
   assert.equal(rouletteRequestSchema.safeParse({...base,tableId,...action,extra:true}).success,false);
  }
 }
});
test("malformed wager, metadata and unknown fields still reject",()=>{
 for(const patch of [
  {tableId:"04"},{tableId:1},{tableId:null},
  {round:0},{round:1.5},{requestId:"bad"},{requestAt:"1792736547857"},
  {requestAt:1.5},{type:"unknown"},{extra:true},
  {bet:{amount:100,kind:"purple"}},{bet:{amount:150,kind:"red"}},
  {bet:{amount:0,kind:"red"}},{bet:{amount:"100",kind:"red"}},
  {bet:{amount:100,kind:"red",dead:false}},
 ]){
  assert.equal(rouletteRequestSchema.safeParse({...captured,...patch}).success,false,JSON.stringify(patch));
 }
});
