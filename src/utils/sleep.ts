/**
 * Utility for delaying execution. Extracted into its own module for testability.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
