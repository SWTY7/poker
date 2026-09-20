import { describe, expect, it } from 'vitest'
import { ordinal } from '../../src/utils/format'

describe('ordinal', () => {
  it('handles the irregular first few', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
  })

  it('special-cases the teens, which do not follow the last-digit rule', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
  })

  it('resumes the last-digit rule once past the teens', () => {
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(23)).toBe('23rd')
    expect(ordinal(24)).toBe('24th')
    expect(ordinal(111)).toBe('111th')
    expect(ordinal(101)).toBe('101st')
  })
})
