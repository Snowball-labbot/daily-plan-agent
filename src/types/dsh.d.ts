/**
 * Ambient shims for the DSH runtime packages.
 *
 * None of these resolve on disk: they are baked into the DSH Desktop bundle and
 * injected by the renderer's module loader / host runtime. The declarations here
 * exist only so `tsc` can typecheck against the surface we actually touch.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    readonly agent?: any
    readonly agents: any
    readonly agentDefaultModel: any
    readonly agentPresets: any
    readonly sessions: any
    readonly workspaceRegistry: any
    readonly storageDomain: any
    readonly connection: any
    readonly tools: any
    readonly logger: { warn(message: string): void; info(message: string): void }
    effect<T>(factory: () => T | Promise<T>, label?: string): T
    on(name: string, listener: (...args: any[]) => any): () => void
    get(name: string): unknown
  }
}

declare module '@deepseek-ai/schemastery' {
  const z: any
  export default z
}

declare module '@deepseek-ai/dsh-agent' {
  export function installModelSelection(agentCtx: unknown, selection: any): () => void
}

declare module '@deepseek-ai/dsh-agent-default-model' {}
declare module '@deepseek-ai/dsh-agent-presets' {}
declare module '@deepseek-ai/dsh-client-connection' {}
declare module '@deepseek-ai/dsh-client-locale' {}
declare module '@deepseek-ai/dsh-client-ui-renderer' {}
declare module '@deepseek-ai/dsh-client-ui-layout' {}
declare module '@deepseek-ai/dsh-client-ui-sidebar' {}
declare module '@deepseek-ai/dsh-client-ui-slots' {}
declare module '@deepseek-ai/dsh-client-store' {}
declare module '@deepseek-ai/dsh-api-gateway' {}
declare module '@deepseek-ai/dsh-host-webserver' {}

declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(value: {
    content: readonly { type: 'text'; text: string }[]
    source: unknown
  }): unknown
}

declare module '@deepseek-ai/dsh-sandbox-policy' {
  export function setSandboxMode(session: unknown, mode: 'read-only' | 'workspace-write'): void
}

declare module '@deepseek-ai/dsh-session' {
  export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
  export type SessionId = string & { readonly __sessionId: unique symbol }
  export function SessionId(value: string): SessionId
}

declare module '@deepseek-ai/dsh-user-approval' {
  export function setApprovalPolicy(session: unknown, policy: 'ask' | 'never'): void
}

declare module '@deepseek-ai/dsh-storage-domain' {
  import type { ZodType } from 'zod'

  export interface KvTable<K extends string, V> {
    get(key: K): V | undefined
    entries(): IterableIterator<[K, V]>
    keys(): IterableIterator<K>
    put(key: K, value: V): Promise<void>
    delete(key: K): Promise<boolean>
    readonly size: number
  }

  export interface Domain<S> {
    table(name: string): KvTable<string, any>
    readonly global: { get(): unknown; set(value: unknown): Promise<void> }
    close(): Promise<void>
    readonly spec?: S
  }

  export type DomainSpec = {
    readonly name: string
    readonly version: number
    readonly tables: Record<string, { readonly valueSchema: ZodType<any> }>
    readonly global?: { readonly schema: ZodType<any> }
    readonly compatibleVersions?: readonly number[]
    readonly layout?: 'single' | 'per-record'
    readonly invalidRecords?: 'backup-and-skip'
  }
}

declare module '@deepseek-ai/dsh-tools' {
  import type { JsonValue } from '@deepseek-ai/dsh-session'
  export type { JsonValue } from '@deepseek-ai/dsh-session'

  export interface ToolRunContext {
    readonly signal: AbortSignal
    readonly agent?: { readonly id: string }
  }

  export interface ToolExecution {
    readonly name: string
    readonly arguments: unknown
  }

  export function defineTool(definition: any): any
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  export const Button: ComponentType<any>
  export const Input: ComponentType<any>
  export const Modal: ComponentType<any>
  export const Pill: ComponentType<any>
  export const Tooltip: ComponentType<any>
  export const StateDot: ComponentType<any>

  export type IconProps = { readonly className?: string; readonly size?: number }
  export const IconChecklistOutline14: ComponentType<IconProps>
  export const IconClockOutline16: ComponentType<IconProps>
  export const IconAlarmClockOutline16: ComponentType<IconProps>
  export const IconGoalOutline16: ComponentType<IconProps>
  export const IconListPenOutline16: ComponentType<IconProps>
  export const IconRefreshOutline16: ComponentType<IconProps>
  export const IconPlusOutline16: ComponentType<IconProps>
  export const IconTrashOutline16: ComponentType<IconProps>
  export const IconEditOutline16: ComponentType<IconProps>
  export const IconCheckOutline16: ComponentType<IconProps>
  export const IconCloseOutline16: ComponentType<IconProps>
  export const IconChevronLeftOutline14: ComponentType<IconProps>
  export const IconChevronRightOutline14: ComponentType<IconProps>
  export const IconChevronDownOutline14: ComponentType<IconProps>
  export const IconSearchOutline16: ComponentType<IconProps>
  export const IconSettingsOutline16: ComponentType<IconProps>
  export const IconDataOutline16: ComponentType<IconProps>
  export const IconArchiveOutline20: ComponentType<IconProps>
  export const IconWarningOutline16: ComponentType<IconProps>
  export const IconSparkle16: ComponentType<IconProps>
  export const IconGraphOutline16: ComponentType<IconProps>
}

declare module '*.css' {
  const content: string
  export default content
}

declare global {
  interface Window {
    __ModuleLoader__: {
      load: (entry: {
        id: string
        factory: (require: (id: string) => any) => unknown
      }) => void
    }
  }
}
