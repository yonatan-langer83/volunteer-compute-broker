export const TASK_SIZES = ['small', 'medium', 'large'] as const

export type TaskSize = (typeof TASK_SIZES)[number]

export type SizeBand = {
  size: TaskSize
  minExclusive: number
  maxInclusive: number
  effort: string
}

// A task's estimatedCostUsd has to sit in the band for its size.
// small  is one sitting. medium is one pull request with tests.
// large is a bigger change that is still one task. Above $100, split it.
export const SIZE_BANDS: readonly SizeBand[] = [
  { size: 'small', minExclusive: 0, maxInclusive: 0.1, effort: 'one sitting, a few files' },
  { size: 'medium', minExclusive: 0.1, maxInclusive: 0.4, effort: 'one pull request with tests' },
  { size: 'large', minExclusive: 0.4, maxInclusive: 100, effort: 'a bigger bounded change, still one task' },
]

export function isTaskSize(value: string): value is TaskSize {
  return (TASK_SIZES as readonly string[]).includes(value)
}

export function sizeBand(size: TaskSize): SizeBand {
  const band = SIZE_BANDS.find((item) => item.size === size)
  if (!band) throw new Error(`unknown size ${size}`)
  return band
}

export function costMatchesSize(cost: number, size: TaskSize): boolean {
  const band = sizeBand(size)
  return cost > band.minExclusive + 1e-9 && cost <= band.maxInclusive + 1e-9
}

export function sizeForCost(cost: number): TaskSize | null {
  const match = SIZE_BANDS.find((band) => cost > band.minExclusive + 1e-9 && cost <= band.maxInclusive + 1e-9)
  return match?.size ?? null
}
