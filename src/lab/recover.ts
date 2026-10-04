import { FEATURES, type FeatureVector } from './features'
import { PARAMS, type ParamKey, type Truth } from './draw'

/**
 * Recovering a seat's drawn character from its play alone: learn the map from
 * summary statistics to parameters on training seats, then score it on seats it
 * has never seen. Two maps, one simple and one flexible, so a parameter that
 * only the flexible one finds is told apart from one neither can.
 */

export interface Row {
  /** Which table the seat sat at: train and test never share one, since a table's bots all read the same opponent model. */
  table: number
  features: FeatureVector
  truth: Truth
}

export interface Scaler {
  mean: number[]
  sd: number[]
}

export function fitScaler(rows: Row[]): Scaler {
  const mean: number[] = []
  const sd: number[] = []
  for (const key of FEATURES) {
    const values = rows.map((r) => r.features[key]).filter((v): v is number => v !== null)
    const m = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
    const variance = values.length > 1 ? values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1) : 0
    mean.push(m)
    sd.push(Math.sqrt(variance) || 1)
  }
  return { mean, sd }
}

/** A standardized vector; a feature the seat never had a chance at sits at the training mean (0). */
export function standardize(features: FeatureVector, scaler: Scaler): number[] {
  return FEATURES.map((key, i) => {
    const value = features[key]
    return value === null ? 0 : (value - scaler.mean[i]) / scaler.sd[i]
  })
}

export interface Predictor {
  predict(features: FeatureVector): Truth
}

function target(row: Row): number[] {
  return PARAMS.map((p) => row.truth[p.key])
}

function toTruth(values: number[]): Truth {
  const truth = {} as Truth
  PARAMS.forEach((p, i) => {
    truth[p.key] = Math.min(p.max, Math.max(p.min, values[i]))
  })
  return truth
}

export function fitNearestNeighbours(rows: Row[], k = 15): Predictor {
  const scaler = fitScaler(rows)
  const xs = rows.map((r) => standardize(r.features, scaler))
  const ys = rows.map(target)
  return {
    predict(features) {
      const x = standardize(features, scaler)
      const nearest = xs
        .map((row, i) => ({ i, d: row.reduce((sum, v, j) => sum + (v - x[j]) ** 2, 0) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k)
      const out = PARAMS.map(() => 0)
      for (const { i } of nearest) ys[i].forEach((v, j) => (out[j] += v / nearest.length))
      return toTruth(out)
    },
  }
}

/** Solves A w = b by Gauss-Jordan elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = m[r][col] / m[col][col]
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

export function fitRidge(rows: Row[], penalty = 5): Predictor {
  const scaler = fitScaler(rows)
  const xs = rows.map((r) => [1, ...standardize(r.features, scaler)])
  const ys = rows.map(target)
  const width = xs[0].length
  const gram = Array.from({ length: width }, (_, i) =>
    Array.from({ length: width }, (_, j) => xs.reduce((sum, x) => sum + x[i] * x[j], 0) + (i === j && i > 0 ? penalty : 0)),
  )
  const weights = PARAMS.map((_, p) =>
    solve(
      gram,
      Array.from({ length: width }, (_, i) => xs.reduce((sum, x, r) => sum + x[i] * ys[r][p], 0)),
    ),
  )
  return {
    predict(features) {
      const x = [1, ...standardize(features, scaler)]
      return toTruth(weights.map((w) => w.reduce((sum, wi, i) => sum + wi * x[i], 0)))
    },
  }
}

export interface ParamScore {
  key: ParamKey
  /** Pearson correlation between truth and prediction on held-out seats. */
  r: number
  /** Share of the truth's variance the prediction explains: 1 is perfect, 0 is no better than guessing the average, below 0 is worse. */
  r2: number
  /** RMSE as a fraction of the spread of what was drawn. */
  nrmse: number
}

export function score(predictor: Predictor, rows: Row[]): ParamScore[] {
  const predictions = rows.map((row) => predictor.predict(row.features))
  return PARAMS.map(({ key }) => {
    const truth = rows.map((row) => row.truth[key])
    const guess = predictions.map((p) => p[key])
    const mt = truth.reduce((a, b) => a + b, 0) / truth.length
    const mg = guess.reduce((a, b) => a + b, 0) / guess.length
    let st = 0
    let sg = 0
    let cross = 0
    let sse = 0
    for (let i = 0; i < truth.length; i++) {
      st += (truth[i] - mt) ** 2
      sg += (guess[i] - mg) ** 2
      cross += (truth[i] - mt) * (guess[i] - mg)
      sse += (truth[i] - guess[i]) ** 2
    }
    const r = st > 0 && sg > 0 ? cross / Math.sqrt(st * sg) : 0
    return { key, r, r2: st > 0 ? 1 - sse / st : 0, nrmse: st > 0 ? Math.sqrt(sse / st) : 0 }
  })
}

/** Rows split by table, so no table is on both sides. */
export function splitByTable(rows: Row[], testShare = 0.3): { train: Row[]; test: Row[] } {
  const tables = [...new Set(rows.map((r) => r.table))].sort((a, b) => a - b)
  const cut = Math.max(1, Math.round(tables.length * (1 - testShare)))
  const train = new Set(tables.slice(0, cut))
  return { train: rows.filter((r) => train.has(r.table)), test: rows.filter((r) => !train.has(r.table)) }
}
