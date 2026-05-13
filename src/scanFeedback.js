/** Ẩn bàn phím ảo (blur focus) + tiếng beep quét — dùng chung POS và AdminHub. */

export function blurActiveElement() {
  try {
    const ae = document.activeElement
    if (ae && typeof ae.blur === 'function') ae.blur()
  } catch {
    /* ignore */
  }
}

export function playScanSuccessBeep() {
  try {
    const audio = new Audio(`${import.meta.env.BASE_URL}beep.mp3`)
    audio.preload = 'auto'
    audio.volume = 1
    void audio.play().catch((e) => console.log('Audio play failed:', e))
  } catch (e) {
    console.log('Audio play failed:', e)
  }
}
