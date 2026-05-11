import { useEffect, useState } from 'react'

/** Hook chỉ UI — không gắn business state. */
export function useViewportMaxWidth(maxPx) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${maxPx}px)`).matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [maxPx])

  return matches
}
