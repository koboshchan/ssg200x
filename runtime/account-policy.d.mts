export type AccountUser = {
 passwordEnabled:boolean;
 privateMetadata?:{admin?:unknown};
 externalAccounts:{provider:string;emailAddress?:string}[];
 primaryEmailAddressId:string|null;
 emailAddresses:{id:string;emailAddress:string;verification?:{status:string}|null}[];
};
export function isolatedQaEmailEnabled(env?:Record<string,string|undefined>):boolean;
export function verifiedAccountEmail(user:AccountUser|null,env?:Record<string,string|undefined>):string|undefined;
