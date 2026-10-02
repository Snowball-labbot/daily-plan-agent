import { createElement } from 'react'
import type { ClientContext, Translate } from './contracts.ts'
import { en, NS, zh } from './locales.ts'
import { createRuntime, focusMemory } from './runtime.ts'
import { Root } from './shell/Root.tsx'
import { SidebarEntry } from './shell/SidebarEntry.tsx'
import { installStyles } from './styles.ts'

export const name = 'dsh-daily-plan-client'
export const inject = ['slots', 'locale', 'connection']

let fallback: Translate = (key: string) => zh[key] ?? key

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dsh-daily-plan: styles')

  let t: Translate = fallback
  if (ctx.locale !== undefined) {
    const locale = ctx.locale
    ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-daily-plan: locale')
    t = locale.bind(NS)
  }

  const runtime = createRuntime(ctx.connection.rpc)
  ctx.effect(
    () => () => {
      runtime.dispose()
    },
    'dsh-daily-plan: runtime',
  )

  // A fire-and-forget RPC that rejects used to vanish without a trace, which
  // made a real failure look like "the feature just does nothing".
  ctx.effect(() => {
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      runtime.notify(message)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, 'dsh-daily-plan: rejection reporter')

  // Full-screen surface. shell.overlay is a list slot with no current occupants,
  // declared by client-ui-layout, and is the documented seat for plugin overlays.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'dsh-daily-plan', order: 60 }, function RootSlot() {
      return createElement(Root, { t, runtime })
    }),
  )

  // Launcher. Also the element we hand focus back to when the overlay closes.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-daily-plan', order: 46, locale: NS },
      function SidebarSlot(rawProps: { wide?: boolean; t?: Translate }) {
        return createElement(SidebarEntry, {
          wide: rawProps?.wide === true,
          t: rawProps?.t ?? t,
          open: () => {
            focusMemory.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
            runtime.open()
          },
        })
      },
    ),
  )
}
