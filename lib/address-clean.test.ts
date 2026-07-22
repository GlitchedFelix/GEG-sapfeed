import { describe, it, expect } from 'vitest'
import { cleanStreet } from './address-clean'

describe('cleanStreet', () => {
  it('leaves a clean address unchanged', () => {
    expect(cleanStreet('12 Church Street')).toEqual({
      structured: '12 Church Street',
      freeText: '12 Church Street',
      changed: false,
    })
  })

  it('strips a shop number before a complex name', () => {
    const result = cleanStreet('Shop 4, Melrose Arch Boulevard')
    expect(result.structured).toBe('Melrose Arch Boulevard')
    expect(result.changed).toBe(true)
  })

  it('strips a unit token in the middle of an address', () => {
    const result = cleanStreet('Unit 12B Southdowns Office Park, 1 Nellmapius Drive')
    expect(result.structured).toContain('Nellmapius Drive')
    expect(result.structured).not.toMatch(/Unit 12B/i)
  })

  it('reduces "Cnr X & Y" to the first street for the structured query', () => {
    const result = cleanStreet('Cnr Main Rd & Church St')
    expect(result.structured).toBe('Main Rd')
    expect(result.freeText).toBe('Main Rd & Church St')
  })

  it('handles "Corner of X and Y" phrasing and keeps trailing context in free text', () => {
    const result = cleanStreet('Corner of 5th Avenue and Oak Street, Sandton')
    expect(result.structured).toBe('5th Avenue')
    expect(result.freeText).toContain('5th Avenue')
    expect(result.freeText).toContain('Oak Street')
    expect(result.freeText).toContain('Sandton')
  })

  it('does not strip a bare complex name with no unit token', () => {
    const result = cleanStreet('Riverside Mall')
    expect(result.structured).toBe('Riverside Mall')
    expect(result.freeText).toBe('Riverside Mall')
    expect(result.changed).toBe(false)
  })

  it('does not eat a street legitimately named "Shop Street"', () => {
    const result = cleanStreet('4 Shop Street')
    expect(result.structured).toBe('4 Shop Street')
  })

  it('collapses a double comma left behind after stripping', () => {
    const result = cleanStreet('Shop 4, , Main Road')
    expect(result.structured).toBe('Main Road')
  })

  it.each([null, undefined, '', '   '])('returns empty output for %p', (input) => {
    expect(cleanStreet(input)).toEqual({ structured: '', freeText: '', changed: false })
  })
})
