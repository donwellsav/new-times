// KillTheRing Animation Frame Hook - RAF with delta timing and fps throttling

import { useEffect, useRef } from 'react'

export interface AnimationFrameCallback {
  (deltaTime: number, timestamp: number): void
}

export function useAnimationFrame(
  callback: AnimationFrameCallback,
  enabled: boolean = true,
  /** Optional max FPS cap. Default 30fps to avoid burning CPU on hidden panels. */
  maxFps: number = 30,
): void {
  const callbackRef = useRef<AnimationFrameCallback>(callback)
  const rafIdRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const minIntervalRef = useRef<number>(1000 / maxFps)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    minIntervalRef.current = 1000 / maxFps
  }, [maxFps])

  useEffect(() => {
    if (!enabled) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      lastTimeRef.current = 0
      return
    }

    const loop = (timestamp: number) => {
      const elapsed = lastTimeRef.current === 0 ? Infinity : timestamp - lastTimeRef.current

      // Throttle to maxFps — skip render if not enough time has passed
      if (elapsed >= minIntervalRef.current) {
        const deltaTime = lastTimeRef.current === 0 ? 0 : elapsed
        lastTimeRef.current = timestamp
        callbackRef.current(deltaTime, timestamp)
      }

      rafIdRef.current = requestAnimationFrame(loop)
    }

    rafIdRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      lastTimeRef.current = 0
    }
  }, [enabled])
}
