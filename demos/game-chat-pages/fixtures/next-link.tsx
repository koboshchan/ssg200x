import React from "react";
export default function Link({href,children,prefetch:_p,...rest}:any){return <a href={href} {...rest}>{children}</a>;}
