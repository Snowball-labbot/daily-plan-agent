import type { ClientRpc } from './contracts.ts'

interface Pending { id: string; endpoint: string; payload: any; createdAt: string }
/** Account-scoped durable cache. Keys from one login never enter another account. */
export function createHttpRpc(owner: string, onStatus: (text: string) => void): ClientRpc & { sync(): Promise<void>; clear(): Promise<void> } {
  let revision: number | undefined
  let syncing: Promise<void> | undefined
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`daily-plan:${owner}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('data')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  async function read(key: string): Promise<any> { const db = await database; return new Promise((resolve, reject) => { const request = db.transaction('data').objectStore('data').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
  async function write(key: string, value: any): Promise<void> { const db = await database; return new Promise((resolve, reject) => { const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }) }
  const cacheKey = (endpoint: string, payload: unknown) => `read:${endpoint}:${JSON.stringify(payload)}`
  async function send(endpoint: string, payload: unknown, id: string, signal?: AbortSignal) {
    const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, payload, operationId: id, expectedRevision: revision }), signal: AbortSignal.any([AbortSignal.timeout(25000), ...(signal ? [signal] : [])]) })
    const data = await response.json().catch(() => { throw new TypeError('服务器没有返回有效结果，补记保留在本机。') })
    if (typeof data.revision === 'number') revision = data.revision
    return data
  }
  // Serial browser calls prevent two edits made on this device from sharing a revision.
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(fn: () => Promise<T>): Promise<T> { const next = tail.then(fn, fn); tail = next.catch(() => undefined); return next }
  async function synchronize() {
    const snapshot = await send('snapshot', {}, crypto.randomUUID())
    if (!snapshot.ok) throw new Error(snapshot.error?.message ?? '请重新登录')
    for (const item of (await read('outbox') ?? []) as Pending[]) {
      const result = await send(item.endpoint, item.payload, item.id)
      if (!result.ok) throw new Error(`补记尚未同步：${result.error?.message ?? '请稍后重试'}`)
      const remaining = ((await read('outbox') ?? []) as Pending[]).filter((row) => row.id !== item.id)
      await write('outbox', remaining)
    }
    await write(cacheKey('snapshot', {}), await send('snapshot', {}, crypto.randomUUID()))
    onStatus('已同步')
  }
  function sync(): Promise<void> {
    if (!syncing) syncing = serial(synchronize).catch((error) => { onStatus(error.message); throw error }).finally(() => { syncing = undefined })
    return syncing
  }
  async function pendingValue(endpoint: string, data: any) {
    if(endpoint === 'plan.block.toggle') {
      const db=await database
      const entries=await new Promise<{key:IDBValidKey;value:any}[]>((resolve,reject)=>{
        const rows:{key:IDBValidKey;value:any}[]=[]
        const request=db.transaction('data').objectStore('data').openCursor()
        request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(rows);return}if(String(cursor.key).startsWith('read:snapshot:'))rows.push({key:cursor.key,value:cursor.value});cursor.continue()}
        request.onerror=()=>reject(request.error)
      })
      for(const {key,value} of entries) {
        if(!value?.ok)continue
        const days=[value.value.today,...(value.value.week ?? [])]
        for(const day of days)if(day?.date===data.date)for(const block of day.blocks ?? [])if(block.id===data.blockId)block.done=data.done
        await write(String(key),value)
      }
    }
    if (endpoint === 'gym.set.log') {
      const key=cacheKey('gym.session',{date:data.date}),cached=await read(key)
      if(cached?.ok) {
        const item=cached.value.items.find((row:any)=>row.id===data.itemId)
        if(item) { item.actualSets=[...(item.actualSets ?? []).filter((row:any)=>row.id!==data.requestId),{...data.set,id:data.requestId,source:'manual',evidence:''}];item.doneSets=item.actualSets.length;await write(key,cached) }
        return cached.value
      }
    }
    return null
  }
  return {
    sync,
    async clear() { const db = await database; await new Promise<void>((resolve, reject) => { const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close(); for(const key of Object.keys(localStorage))if(key.startsWith('daily-plan-feedback:') || key.startsWith('daily-plan-job:'))localStorage.removeItem(key) },
    call(_channel, endpoint, payload, signal) { return serial(async () => {
      const id = crypto.randomUUID()
      const supportsOffline=['plan.block.toggle','gym.set.log'].includes(endpoint)
      const data=structuredClone(payload) as any
      if(endpoint==='gym.set.log')data.requestId ??= id
      if(navigator.onLine && ((await read('outbox') ?? []) as Pending[]).length) await synchronize()
      if(supportsOffline) { const rows:Pending[]=await read('outbox') ?? [];rows.push({id,endpoint,payload:data,createdAt:new Date().toISOString()});await write('outbox',rows) }
      if (navigator.onLine) {
        try {
          const result = await send(endpoint, data, id, signal)
          if(supportsOffline)await write('outbox',((await read('outbox') ?? []) as Pending[]).filter(row=>row.id!==id))
          if (result.ok && !['workflow.start','workflow.status','workflow.cancel'].includes(endpoint)) await write(cacheKey(endpoint, payload), result)
          return result
        } catch (error) {
          // A timeout does not mean the server failed to commit; keep this operation ID.
          if (signal?.aborted) throw error
          if (!(error instanceof TypeError) && !(error instanceof DOMException && ['TimeoutError','AbortError'].includes(error.name))) throw error
        }
      }
      if (supportsOffline) {
        const rows: Pending[] = await read('outbox') ?? []
        onStatus(`离线补记 ${rows.length} 项，联网后同步`)
        return { ok: true, value: await pendingValue(endpoint,data) }
      }
      const cached = await read(cacheKey(endpoint, payload))
      if (cached && ['snapshot','gym.session','gym.exercises','gym.performance','workflow.context'].includes(endpoint)) { onStatus('离线 · 显示上次同步记录'); return cached }
      return { ok: false, error: { message: '当前离线。训练补记和完成状态会保存在此设备，AI 安排需要联网。' } }
    }) },
  }
}
