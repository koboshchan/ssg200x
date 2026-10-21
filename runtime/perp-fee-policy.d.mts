export const DEFAULT_PERP_FEE_PPM: 300;

export function roomFeeRates(room:{perpOpeningFeePpm?:number;perpClosingFeePpm?:number;perpFeePpm?:number}):{openingFeePpm:number;closingFeePpm:number};
export function positionFeeRates(position:{openingFeePpm?:number;closingFeePpm?:number;feePpm?:number}):{openingFeePpm:number;closingFeePpm:number};

export function feeCents(margin:number,leverage:number,entry:number,mark:number,ppm:number):number;

export function openingFeeCents(postedMargin:number,leverage:number,ppm:number):number;
