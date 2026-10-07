/**
 * Validates a Kazakhstan BIN (company) or IIN (individual): 12 digits with a check digit.
 * The check digit is the weighted sum of the first 11 digits mod 11 (weights 1..11); when that
 * gives 10, a second pass uses weights 3..11,1,2; a second 10 means the number is invalid.
 */
export function isValidBinIin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const weighted = (weights: number[]) =>
    weights.reduce((sum, weight, index) => sum + weight * digits[index]!, 0) % 11;
  let check = weighted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (check === 10) {
    check = weighted([3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]);
    if (check === 10) return false;
  }
  return check === digits[11];
}
