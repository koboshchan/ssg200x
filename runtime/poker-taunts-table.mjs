// Pure runtime table projection. Table 01 is intentionally legacy top-level state.
export const validPokerTable=id=>["01","02","03"].includes(id);
export function pokerSeats(room,id){
 if(!validPokerTable(id))throw Error("invalid");
 return (id==="01"?room?.seats:room?.pokerTables?.[id]?.seats)||[];
}
