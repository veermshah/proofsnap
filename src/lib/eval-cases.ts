import { SAMPLES } from "./samples";

/**
 * Small hand-labeled eval set: intro-proof style proofs with the step that is wrong (if any).
 * `expectErrorStep` = the first step a careful grader would mark wrong. null = proof is correct.
 */
export type EvalCase = { id: string; text: string; expectVerdict: "correct" | "has_errors"; expectErrorStep: number | null };

export const EVAL_CASES: EvalCase[] = [
  { id: "odd-square", text: SAMPLES[0].text, expectVerdict: "correct", expectErrorStep: null },
  { id: "divides-product", text: SAMPLES[1].text, expectVerdict: "has_errors", expectErrorStep: 2 },
  { id: "induction-sum", text: SAMPLES[2].text, expectVerdict: "has_errors", expectErrorStep: 4 },
  {
    id: "even-plus-even",
    expectVerdict: "correct",
    expectErrorStep: null,
    text: `Theorem: The sum of two even integers is even.
Proof:
1. Let a and b be even integers, so a = 2m and b = 2n for some integers m, n.
2. Then a + b = 2m + 2n = 2(m + n).
3. Since m + n is an integer, a + b is even.`,
  },
  {
    id: "square-even-converse-wrong",
    expectVerdict: "has_errors",
    expectErrorStep: 2,
    text: `Theorem: If n^2 is even, then n is even (n an integer).
Proof:
1. Suppose n^2 is even, so n^2 = 2k for some integer k.
2. Then n = 2(k/n), so n is 2 times something.
3. Therefore n is even.`,
  },
  {
    id: "ineq-am-gm",
    expectVerdict: "correct",
    expectErrorStep: null,
    text: `Theorem: For all real numbers a and b, a^2 + b^2 >= 2ab.
Proof:
1. (a - b)^2 >= 0 because squares are nonnegative.
2. Expanding, a^2 - 2ab + b^2 >= 0.
3. Adding 2ab to both sides gives a^2 + b^2 >= 2ab.`,
  },
  {
    id: "ineq-sign-flip",
    expectVerdict: "has_errors",
    expectErrorStep: 2,
    text: `Theorem: For all real numbers x, if x < 2 then x^2 < 4.
Proof:
1. Suppose x < 2.
2. Squaring both sides of x < 2 gives x^2 < 4.
3. So x^2 < 4.`,
  },
  {
    id: "induction-pow",
    expectVerdict: "correct",
    expectErrorStep: null,
    text: `Theorem: For every natural number n, 2^n >= n + 1.
Proof by induction.
1. Base case: n = 0, 2^0 = 1 >= 1.
2. Inductive hypothesis: assume 2^k >= k + 1.
3. Then 2^(k+1) = 2 * 2^k >= 2(k + 1).
4. And 2(k + 1) = 2k + 2 >= k + 2.
5. So 2^(k+1) >= (k + 1) + 1, completing the induction.`,
  },
  {
    id: "div-by-3",
    expectVerdict: "has_errors",
    expectErrorStep: 3,
    text: `Theorem: For every integer n, n^3 - n is divisible by 6.
Proof:
1. n^3 - n = (n - 1) n (n + 1).
2. This is a product of three consecutive integers, so one of them is divisible by 3.
3. Therefore n^3 - n is divisible by 6.`,
  },
];
