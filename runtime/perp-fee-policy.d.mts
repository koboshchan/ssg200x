export const DEFAULT_PERP_FEE_PPM: 300;

export function roomFeeRates(room:{perpOpeningFeePpm?:number;perpClosingFeePpm?:number;perpFeePpm?:number}):{openingFeePpm:number;closingFeePpm:number};
export function positionFeeRates(position:{openingFeePpm?:number;closingFeePpm?:number;feePpm?:number}):{openingFeePpm:number;closingFeePpm:number};

export function feeCents(margin:number,leverage:number,entry:number,mark:number,ppm:number):number;

export function openingFeeCents(postedMargin:number,leverage:number,ppm:number):number;

export type ClosingFeeMode="notional"|"profit";
export function closingFeeMode(snapshot:{closingFeeMode?:ClosingFeeMode;perpClosingFeeMode?:ClosingFeeMode}):ClosingFeeMode;
export function closingFeeReserve(position:{closingFeeMode?:ClosingFeeMode;closingFeePpm?:number;feePpm?:number}):number;
export function closingFeeCents(position:{closingFeeMode?:ClosingFeeMode;margin:number;leverage:number;entry:number;closingFeePpm?:number;feePpm?:number;openingFee?:number},mark:number,grossPnl:number,liquidated?:boolean):number;
