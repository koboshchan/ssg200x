/** Shared house rule: exactly one black seven and one black eight, either suit/order. */
export function isBlack78(cards:readonly string[]){
 return cards.length===2&&cards.every(card=>/^[78][sc]$/.test(card))&&cards[0][0]!==cards[1][0];
}
