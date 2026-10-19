export class BoundedBackoff {
  private value: number;

  constructor(private readonly initialMs = 2_000, private readonly maxMs = 30_000) {
    this.value = initialMs;
  }

  next(): number {
    const current = this.value;
    this.value = Math.min(this.value * 2, this.maxMs);
    return current;
  }

  reset(): void {
    this.value = this.initialMs;
  }
}
