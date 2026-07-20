/**
 * Feature-drift and calibration math shared by the models dashboard and the
 * automated model-lifecycle job. Drift is the mean standardized shift of each
 * feature between the newer and older halves of recent predictions.
 */

export type FeatureRow = Record<string, number>;

export interface DriftResult {
  sampleSize: number;
  score: number | null;
  level: 'insufficient_data' | 'stable' | 'watch' | 'alert';
}

export function extractFeatureRows(
  predictions: Array<{ features: unknown }>,
): FeatureRow[] {
  return predictions
    .map((prediction) => prediction.features)
    .filter(
      (features): features is FeatureRow =>
        typeof features === 'object' &&
        features !== null &&
        !Array.isArray(features),
    );
}

export function computeDrift(featureRows: FeatureRow[]): DriftResult {
  // Avoid comparing different symbols from a single small inference batch;
  // drift needs two reasonably sized temporal populations.
  const split = featureRows.length >= 40 ? Math.floor(featureRows.length / 2) : 0;
  if (split === 0) {
    return { sampleSize: featureRows.length, score: null, level: 'insufficient_data' };
  }
  const recentFeatures = featureRows.slice(0, split);
  const baselineFeatures = featureRows.slice(split);
  const featureKeys = Object.keys(featureRows[0] ?? {});
  const shifts = featureKeys
    .map((key) => {
      const recentValues = recentFeatures
        .map((row) => Number(row[key]))
        .filter(Number.isFinite);
      const baselineValues = baselineFeatures
        .map((row) => Number(row[key]))
        .filter(Number.isFinite);
      if (recentValues.length === 0 || baselineValues.length < 2) return null;
      const mean = (values: number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const baselineMean = mean(baselineValues);
      const variance =
        baselineValues.reduce(
          (sum, value) => sum + (value - baselineMean) ** 2,
          0,
        ) /
        (baselineValues.length - 1);
      return (
        Math.abs(mean(recentValues) - baselineMean) /
        Math.max(Math.sqrt(variance), 1e-9)
      );
    })
    .filter((value): value is number => value !== null);
  const score =
    shifts.length > 0
      ? shifts.reduce((sum, value) => sum + value, 0) / shifts.length
      : null;
  return {
    sampleSize: featureRows.length,
    score,
    level:
      score === null
        ? 'insufficient_data'
        : score >= 1
          ? 'alert'
          : score >= 0.5
            ? 'watch'
            : 'stable',
  };
}

const BRIER_LABELS = ['tp', 'sl', 'timeout'] as const;

export function computeBrier(
  predictions: Array<{ probabilities: unknown; actualLabel: string | null }>,
): { sampleSize: number; brierScore: number | null } {
  const rows = predictions
    .filter((prediction) => prediction.actualLabel)
    .map((prediction) => {
      const probabilities = prediction.probabilities as Record<string, number>;
      return (
        BRIER_LABELS.reduce((sum, label) => {
          const expected = prediction.actualLabel === label ? 1 : 0;
          return sum + (Number(probabilities?.[label] ?? 0) - expected) ** 2;
        }, 0) / BRIER_LABELS.length
      );
    });
  return {
    sampleSize: rows.length,
    brierScore:
      rows.length > 0
        ? rows.reduce((sum, value) => sum + value, 0) / rows.length
        : null,
  };
}
