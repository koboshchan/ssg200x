export const DEFAULT_PERP_FEE_PPM: 300;

export function roomFeeRates(room:{perpOpeningFeePpm?:number;perpClosingFeePpm?:number;perpFeePpm?:number}):{openingFeePpm:number;closingFeePpm:number};
export function positionFeeRates(position:{openingFeePpm?:number;closingFeePpm?:number;feePpm?:number}):{openingFeePpm:number;closingFeePpm:number};
