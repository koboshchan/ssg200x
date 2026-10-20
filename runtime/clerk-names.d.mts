export type ClerkProfile={id?:string;fullName?:string|null;firstName?:string|null;lastName?:string|null;username?:string|null;primaryEmailAddressId?:string|null;primaryEmailAddress?:{emailAddress:string}|null;emailAddresses?:{id:string;emailAddress:string}[];imageUrl?:string};
export type DisplayProfiles=Map<string,{name:string;avatar:string|null}>;
export function clerkDisplayName(user:ClerkProfile|null|undefined):string;
export function loadClerkProfiles(clerk:{users:{getUserList(params:{userId:string[];limit:number}):Promise<{data:ClerkProfile[]}>}},ids:string[]):Promise<DisplayProfiles>;
export function profileName(profiles:DisplayProfiles,id:string):string;
export function roomWithClerkNames<T extends {members:{id:string;publicId:string;name:string}[]}>(room:T,profiles:DisplayProfiles):T;
export function playerReference(member:{publicId:string}|null|undefined):string;
