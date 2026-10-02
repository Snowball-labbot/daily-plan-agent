import { useEffect, useState, type CSSProperties } from 'react'

/** Fixed panels follow the visible screen when the mobile keyboard pans it. */
export function phoneViewport(
  layoutHeight: number,
  height: number,
  top: number,
  scale = 1,
) {
  // Let browser zoom work normally; do not mistake pinch zoom for a keyboard.
  const visible =
    scale > 1.01 ? layoutHeight : Math.min(layoutHeight, Math.max(1, height))
  const offset =
    scale > 1.01 ? 0 : Math.max(0, Math.min(top, layoutHeight - visible))
  return {
    height: visible,
    top: offset,
    bottom: Math.max(0, layoutHeight - visible - offset),
  }
}

export function usePhoneViewport(enabled = true) {
  const [viewport, setViewport] = useState<ReturnType<
    typeof phoneViewport
  > | null>(null)
  useEffect(() => {
    if (!enabled) return
    const visual = window.visualViewport
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setViewport(
          phoneViewport(
            window.innerHeight,
            visual?.height ?? window.innerHeight,
            visual?.offsetTop ?? 0,
            visual?.scale ?? 1,
          ),
        ),
      )
    }
    update()
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [enabled])
  return {
    style: (enabled && viewport
      ? {
          '--phone-visible-height': `${viewport.height}px`,
          '--phone-visible-top': `${viewport.top}px`,
          '--phone-visible-bottom': `${viewport.bottom}px`,
        }
      : {}) as CSSProperties,
    short: enabled && viewport !== null && viewport.height < 560,
  }
}
