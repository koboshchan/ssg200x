/** Blackjack bet input: ASCII dollars with up to two fractional digits. String-based, no floats or rounding. */
export function isBlackjackInputText(value: string): boolean {
 return /^[0-9]{0,9}(\.[0-9]{0,2})?$/.test(value);
}
export function blackjackInputCents(value: string): number | null {
 const m=/^([0-9]{1,9})(?:\.([0-9]{1,2}))?$/.exec(value);
 if(!m) return null;
 const cents=Number(m[1])*100+Number((m[2]??"").padEnd(2,"0"));
 return Number.isSafeInteger(cents)?cents:null;
}
