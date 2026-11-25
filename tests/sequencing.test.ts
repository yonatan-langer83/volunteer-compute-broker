import { describe, expect, it } from 'vitest'
import { blockingTask, patternsOverlap } from '../src/sequencing.js'

describe('one open change per file', () => {
  it('compares paths and patterns', () => {
    expect(patternsOverlap('locales/he.json', 'locales/he.json')).toBe(true)
    expect(patternsOverlap('locales/he.json', 'locales/ar.json')).toBe(false)
    expect(patternsOverlap('locales/*.json', 'locales/he.json')).toBe(true)
    expect(patternsOverlap('docs/**', 'src/index.ts')).toBe(false)
    expect(patternsOverlap('docs/**', 'docs/guide/*.md')).toBe(true)
    expect(patternsOverlap('./README.md', 'README.md')).toBe(true)
  })

  it('holds back a task whose files are taken in the same project', () => {
    const he = { id: 'a', projectId: 'p', scopeDo: ['locales/he.json'] }
    const he2 = { id: 'b', projectId: 'p', scopeDo: ['locales/he.json', 'docs/he.md'] }
    const ar = { id: 'c', projectId: 'p', scopeDo: ['locales/ar.json'] }
    const otherProject = { id: 'd', projectId: 'q', scopeDo: ['locales/he.json'] }
    expect(blockingTask(he2, [he])?.id).toBe('a')
    expect(blockingTask(ar, [he])).toBeNull()
    expect(blockingTask(otherProject, [he])).toBeNull()
    expect(blockingTask(he, [he])).toBeNull()
  })
})

describe('scope entries', () => {
  it('reads paths the way the workspace does and treats folders as prefixes', () => {
    expect(patternsOverlap('docs/', 'docs/he/welcome.md')).toBe(true)
    const a = { id: 'a', projectId: 'p', scopeDo: ['docs/welcome.md (new file)'] }
    const b = { id: 'b', projectId: 'p', scopeDo: ['docs/welcome.md'] }
    const prose = { id: 'c', projectId: 'p', scopeDo: ['the files the instructions name'] }
    expect(blockingTask(b, [a])?.id).toBe('a')
    expect(blockingTask(prose, [a])).toBeNull()
  })
})
