export const UNLOCK_STORAGE_KEY = 'mp-auto-rating-unlocked'

export function createUnlockPersistence(storage) {
  return {
    isUnlocked() {
      return storage.getItem(UNLOCK_STORAGE_KEY) === '1'
    },
    unlock() {
      storage.setItem(UNLOCK_STORAGE_KEY, '1')
    },
    lock() {
      storage.removeItem(UNLOCK_STORAGE_KEY)
    },
  }
}
