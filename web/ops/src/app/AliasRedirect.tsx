import { Navigate, useLocation } from "react-router-dom"
export function AliasRedirect({to}: {to: string}) {
 const location = useLocation()
 return <Navigate replace to={{pathname: to, search: location.search, hash: location.hash}} />
}
