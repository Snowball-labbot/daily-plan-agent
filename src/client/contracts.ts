import type { ComponentType } from 'react'

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

/** The slot keys this plugin registers into. */
export type SlotName = 'shell.overlay' | 'sidebar.footer.action'

export interface SlotRegistry {
  inject(name: SlotName, register: () => void | (() => void)): void
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
}

export interface LocaleService {
  register(
    namespace: string,
    dictionaries: { readonly zh: Record<string, string>; readonly en: Record<string, string> },
  ): () => void
  bind(namespace: string): Translate
}

export interface ClientContext {
  effect(factory: () => void | (() => void), label?: string): void
  connection: { readonly rpc: ClientRpc }
  locale?: LocaleService
  slots: SlotRegistry
}

export interface SidebarProps {
  readonly wide: boolean
  readonly t: Translate
  readonly open: () => void
}
