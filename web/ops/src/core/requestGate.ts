export class LatestRequestGate {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(id: number): boolean {
    return id === this.current;
  }
}
