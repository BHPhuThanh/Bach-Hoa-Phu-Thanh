/**
 * Hàng đợi hoàn thành phiếu nhập — chạy tuần tự, promise không bị “thả nổi” khi đổi tab.
 * Gắn với App/AdminHub: luôn `await enqueueInboundCompletion(task)` trước khi đóng form.
 */

let tail = Promise.resolve()

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function enqueueInboundCompletion(task) {
  const run = tail.then(() => task())
  tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
