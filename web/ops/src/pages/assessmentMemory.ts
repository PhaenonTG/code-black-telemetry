/** Session-only retention, scoped to the provider config identity (no persistence). */
export function createAssessmentMemory<T>() {
  const entries = new WeakMap<object, { value: T; receivedAt: number }>()
  return {
    read: (scope: object) => entries.get(scope),
    remember: (scope: object, value: T, receivedAt = Date.now()) => {
      const entry = { value, receivedAt }
      entries.set(scope, entry)
      return entry
    },
  }
}
