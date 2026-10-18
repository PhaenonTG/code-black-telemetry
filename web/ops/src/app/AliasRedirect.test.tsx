import { renderToString } from "react-dom/server"
import { MemoryRouter, Routes, Route, useLocation, matchRoutes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AliasRedirect } from "./AliasRedirect"
import { ROUTES, ROUTE_ALIASES } from "./routes"
vi.mock("react-router-dom",async importOriginal=>({
 ...await importOriginal<typeof import("react-router-dom")>(),
 Navigate:({to,replace}:{to:{pathname:string;search:string;hash:string};replace:boolean})=><span data-destination={`${to.pathname}${to.search}${to.hash}`} data-replace={String(replace)}/>,
}))
function Canonical(){const location=useLocation();return <span>{location.pathname}</span>}
describe("label-matching aliases",()=>{
 it.each(Object.entries(ROUTE_ALIASES))("redirects %s to %s preserving search/hash with replacement",(alias,canonical)=>{
  const html=renderToString(<MemoryRouter initialEntries={[`${alias}?unit=striker#status`]}><Routes><Route path={alias} element={<AliasRedirect to={canonical}/>}/></Routes></MemoryRouter>)
  expect(html).toContain(`data-destination="${canonical}?unit=striker#status"`)
  expect(html).toContain('data-replace="true"')
  expect(ROUTES.some(route=>route.path===canonical)).toBe(true)
  expect(matchRoutes([{path:canonical}],canonical)).not.toBeNull()
  expect(renderToString(<MemoryRouter initialEntries={[canonical]}><Routes><Route path={canonical} element={<Canonical/>}/></Routes></MemoryRouter>)).toContain(canonical)
 })
})
