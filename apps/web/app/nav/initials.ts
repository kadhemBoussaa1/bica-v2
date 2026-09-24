/**
 * Initials for an avatar. Two letters where the name has two words, so
 * "Nabil Ben Ali" reads NB rather than N. Shared by the top bar and the
 * settings' user rows, so the same person gets the same letters everywhere.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
