/** Build a fetch double with Bun's callable preconnect member. */
export function fakeFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(implementation, { preconnect() {} });
}
