import {describe,it,expect,vi,afterEach} from 'vitest'
import {outlookVisibility} from './outlookVisibility'
// @ts-expect-error Existing JavaScript poller has no declaration file.
import {visibleSnapshotPoller} from '../../pages/visibleSnapshotPoller.mjs'
afterEach(()=>vi.useRealTimers())
describe('retained Outlook tab polling',()=>{
 it('aborts in-flight reads and pauses the 30s poll when either visibility boundary hides',async()=>{
  vi.useFakeTimers()
  const events=new EventTarget()
  const doc=Object.assign(events,{hidden:false,visibilityState:'visible'}) as unknown as Document
  let panelHidden=false,changed:()=>void=()=>{}
  const disconnected=vi.fn()
  class Observer{constructor(callback:()=>void){changed=callback}observe(){}disconnect(){disconnected()}}
  const panel={hasAttribute:()=>panelHidden} as unknown as Element
  const visibility=outlookVisibility(doc,panel,Observer as unknown as typeof MutationObserver)
  let signal:AbortSignal|undefined
  const load=vi.fn((value:AbortSignal)=>{signal=value;return new Promise((_resolve,reject)=>value.addEventListener('abort',()=>reject(new DOMException('hidden','AbortError'))))})
  const poll=visibleSnapshotPoller({visibility,intervalMs:30000,load,onData:vi.fn(),onError:vi.fn()})
  expect(load).toHaveBeenCalledOnce()
  panelHidden=true;changed();expect(signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(120000);expect(load).toHaveBeenCalledOnce()
  panelHidden=false;changed();expect(load).toHaveBeenCalledTimes(2)
  Object.defineProperty(doc,'visibilityState',{value:'hidden',configurable:true});events.dispatchEvent(new Event('visibilitychange'))
  expect(signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(120000);expect(load).toHaveBeenCalledTimes(2)
  poll.stop();visibility.stop();expect(disconnected).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
 })
 it('does not start a read when the retained tab was already hidden',()=>{
  const doc=Object.assign(new EventTarget(),{hidden:false,visibilityState:'visible'}) as unknown as Document
  class Observer{observe(){}disconnect(){}}
  const visibility=outlookVisibility(doc,{hasAttribute:()=>true} as unknown as Element,Observer as unknown as typeof MutationObserver)
  const load=vi.fn(),poll=visibleSnapshotPoller({visibility,intervalMs:30000,load,onData:vi.fn(),onError:vi.fn()})
  expect(load).not.toHaveBeenCalled();poll.stop();visibility.stop()
 })
})
