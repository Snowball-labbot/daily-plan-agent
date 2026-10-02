export interface RpcFailure {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface RpcEnvelope<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: RpcFailure
}

export function unwrap<T>(raw: unknown): T {
  const envelope = raw as RpcEnvelope<T> | null
  if (envelope === null || typeof envelope !== 'object') {
    throw new Error('RPC 返回了非对象结果')
  }
  if (envelope.ok === true) return envelope.value as T
  throw new Error(envelope.error?.message ?? 'RPC 调用失败')
}
