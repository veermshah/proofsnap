export type Sample = { id: string; label: string; tag: "correct" | "flawed"; text: string };

export const SAMPLES: Sample[] = [
  {
    id: "odd-square",
    label: "Odd squared is odd",
    tag: "correct",
    text: `Theorem: If n is an odd integer, then n^2 is odd.

Proof:
1. Since n is odd, n = 2k + 1 for some integer k.
2. Then n^2 = (2k+1)^2 = 4k^2 + 4k + 1.
3. So n^2 = 2(2k^2 + 2k) + 1.
4. Since 2k^2 + 2k is an integer, n^2 is odd.`,
  },
  {
    id: "divides-product",
    label: "a | bc means a | b or a | c",
    tag: "flawed",
    text: `Theorem: For positive integers a, b, c, if a divides bc, then a divides b or a divides c.

Proof:
1. Suppose a divides bc, so bc = a*m for some integer m.
2. Then every prime factor of a appears in b or in c.
3. Therefore a divides b or a divides c.`,
  },
  {
    id: "induction-sum",
    label: "Sum of 1..n (induction slip)",
    tag: "flawed",
    text: `Theorem: For every natural number n, 1 + 2 + ... + n = n(n+1)/2.

Proof by induction on n.
1. Base case: for n = 0 the sum is empty, so it equals 0 = 0*1/2.
2. Inductive hypothesis: assume 1 + ... + k = k(k+1)/2.
3. Then 1 + ... + k + (k+1) = k(k+1)/2 + (k+1).
4. This equals (k+1)(k+1)/2.
5. So the formula holds for k+1, which completes the induction.`,
  },
];
