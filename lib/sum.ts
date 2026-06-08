export function sum(...numbers: number[]): number {
  return numbers.reduce((total, value) => total + value, 0);
}
