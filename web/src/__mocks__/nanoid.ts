let _counter = 0;
export function nanoid(_size?: number): string {
  return `test-id-${++_counter}`;
}
