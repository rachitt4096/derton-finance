import { useEffect } from 'react'

/**
 * Treat the terminal as a fixed 1680×945 (16:9) design and scale-to-fill the
 * viewport with crisp CSS `zoom`. The layout then looks identical at every
 * screen size and never reflows — so it can't develop layout/overlap errors.
 *
 * Publishes the factor as the `--ui-scale` custom property on <html>; the
 * `.app-shell` rules in 07-responsive-viewport-fit.css consume it (size the
 * shell to viewport / scale in both axes, then zoom back up to fill).
 */
const DESIGN_W = 1680
const DESIGN_H = 945
const MIN_SCALE = 0.6
const MAX_SCALE = 3

export default function useViewportScale() {
  useEffect(() => {
    let frame = 0

    const apply = () => {
      frame = 0
      const w = window.innerWidth
      const h = window.innerHeight
      if (!w || !h) return
      const raw = Math.min(w / DESIGN_W, h / DESIGN_H)
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw))
      document.documentElement.style.setProperty('--ui-scale', scale.toFixed(4))
    }

    const onResize = () => {
      if (frame) return
      frame = window.requestAnimationFrame(apply)
    }

    apply()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (frame) window.cancelAnimationFrame(frame)
      document.documentElement.style.removeProperty('--ui-scale')
    }
  }, [])
}
