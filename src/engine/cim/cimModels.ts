import { CIM_MODELS, type CimModel } from './cimModelsData';

export interface CimValidationResult {
  model: CimModel;
  requiredPresent: string[];
  requiredMissing: string[];
  recommendedPresent: string[];
  recommendedMissing: string[];
  requiredPercent: number;
  totalPercent: number;
}

export function validateCimCompliance(
  extractedFields: Set<string>,
  options?: { includeAll?: boolean }
): CimValidationResult[] {
  const results = CIM_MODELS.map((model) => {
    const requiredPresent = model.requiredFields.filter((f) => extractedFields.has(f));
    const requiredMissing = model.requiredFields.filter((f) => !extractedFields.has(f));
    const recommendedPresent = model.recommendedFields.filter((f) => extractedFields.has(f));
    const recommendedMissing = model.recommendedFields.filter((f) => !extractedFields.has(f));

    const totalFields = model.requiredFields.length + model.recommendedFields.length;
    const totalPresent = requiredPresent.length + recommendedPresent.length;

    const requiredPercent = model.requiredFields.length > 0
      ? Math.round((requiredPresent.length / model.requiredFields.length) * 100)
      : 100;

    const totalPercent = totalFields > 0
      ? Math.round((totalPresent / totalFields) * 100)
      : 100;

    return {
      model,
      requiredPresent,
      requiredMissing,
      recommendedPresent,
      recommendedMissing,
      requiredPercent,
      totalPercent,
    };
  });

  const filtered = options?.includeAll
    ? results
    : results.filter((r) => r.requiredPresent.length > 0 || r.recommendedPresent.length > 0);

  return filtered.sort((a, b) => b.totalPercent - a.totalPercent);
}
