/**
 * Normalize a name into a URL-safe slug:
 * 1. Strip Vietnamese diacritics (and other combining marks)
 * 2. Lowercase
 * 3. Replace non-alphanumeric runs with a single hyphen
 * 4. Trim leading/trailing hyphens
 *
 * Examples:
 *   "dự án 1"        → "du-an-1"
 *   "Hệ Thống Quản Lý" → "he-thong-quan-ly"
 *   "My  Project!!"  → "my-project"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")                // decompose accented chars → base + combining mark
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .replace(/đ/g, "d")             // Vietnamese đ (lowercase)
    .replace(/Đ/g, "d")             // Vietnamese Đ (uppercase)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")    // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "");       // trim leading/trailing hyphens
}
