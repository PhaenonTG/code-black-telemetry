import { handlePrivateApiRequest as original } from './core-gateway.original.mjs';
import { handlePrivateRadarRequest } from './radar-gateway.mjs';
export { handlePrivateCoreRequest, handlePrivateOverlayRequest } from './core-gateway.original.mjs';
export function handlePrivateApiRequest(request,env,fetchImpl=fetch){
 return new URL(request.url).pathname.startsWith('/api/v1/radar/') ? handlePrivateRadarRequest(request,env,fetchImpl) : original(request,env,fetchImpl);
}
