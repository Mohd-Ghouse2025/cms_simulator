/**
 * Helpers for working with transaction identifiers.
 *
 * The backend now returns canonical, already padded CMS transaction IDs.
 * The frontend should not attempt to mutate that format (e.g. padding or
 * trimming). Instead, we simply pick the first non-empty identifier from
 * the available payload fields and pass it through untouched.
 */
export const pickCanonicalTransactionId = (
  ...candidates: Array<string | number | null | undefined>
): string | undefined => {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    const value =
      typeof candidate === "string" ? candidate.trim() : String(candidate).trim();
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
};
