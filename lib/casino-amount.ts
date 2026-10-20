/** Casino entry amounts use cents on the wire, but only whole currency units.
 * Do not use for wallet balances, trading, transfers, or settlement payouts. */
export function isWholeCasinoAmount(cents: unknown): cents is number {
 return typeof cents === "number" && Number.isSafeInteger(cents) && cents % 100 === 0;
}
/** Inputs accept ASCII digits only; no coercion, rounding, decimal or exponent syntax. */
export function casinoInputCents(value: string): number | null {
 if (!/^[0-9]+$/.test(value)) return null;
 const cents = Number(value) * 100;
 return isWholeCasinoAmount(cents) ? cents : null;
}
export function isCasinoInputText(value: string): boolean {
 return /^[0-9]*$/.test(value);
}
