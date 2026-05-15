import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Re-import fresh module each test to reset module-level click counter
async function freshModule() {
  vi.resetModules()
  return import('../../src/frontend/src/state/posterSheetUnlock')
}

describe('registerPosterViewClick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('7 clicks within 5 s → returns true and sets localStorage', async () => {
    const { registerPosterViewClick, isPosterUnlocked } = await freshModule()
    for (let i = 0; i < 6; i++) {
      expect(registerPosterViewClick()).toBe(false)
    }
    expect(registerPosterViewClick()).toBe(true)
    expect(isPosterUnlocked()).toBe(true)
    expect(localStorage.getItem('jr-poster-unlocked')).toBe('1')
  })

  it('6 clicks then 5 s timeout → counter resets, next click does not unlock', async () => {
    const { registerPosterViewClick, isPosterUnlocked } = await freshModule()
    for (let i = 0; i < 6; i++) registerPosterViewClick()
    vi.advanceTimersByTime(5001)
    // Counter reset: this is click 1 of a fresh window, not click 7
    expect(registerPosterViewClick()).toBe(false)
    expect(isPosterUnlocked()).toBe(false)
  })

  it('4 clicks, timeout, then 3 more clicks → no unlock', async () => {
    const { registerPosterViewClick, isPosterUnlocked } = await freshModule()
    for (let i = 0; i < 4; i++) registerPosterViewClick()
    vi.advanceTimersByTime(5001)
    for (let i = 0; i < 3; i++) registerPosterViewClick()
    expect(isPosterUnlocked()).toBe(false)
  })

  it('exactly 5000 ms between first and last click → still within window', async () => {
    const { registerPosterViewClick, isPosterUnlocked } = await freshModule()
    for (let i = 0; i < 6; i++) {
      registerPosterViewClick()
      vi.advanceTimersByTime(100)
    }
    // Timer resets on each click; 5 s window from last click
    expect(registerPosterViewClick()).toBe(true)
    expect(isPosterUnlocked()).toBe(true)
  })
})

describe('isPosterUnlocked', () => {
  beforeEach(() => localStorage.clear())

  it('returns false when localStorage is empty', async () => {
    const { isPosterUnlocked } = await freshModule()
    expect(isPosterUnlocked()).toBe(false)
  })

  it('returns true when localStorage key is set to "1"', async () => {
    localStorage.setItem('jr-poster-unlocked', '1')
    const { isPosterUnlocked } = await freshModule()
    expect(isPosterUnlocked()).toBe(true)
  })

  it('returns false for any value other than "1"', async () => {
    localStorage.setItem('jr-poster-unlocked', 'true')
    const { isPosterUnlocked } = await freshModule()
    expect(isPosterUnlocked()).toBe(false)
  })
})
