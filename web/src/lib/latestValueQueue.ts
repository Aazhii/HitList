/**
 * Serializes writes for one editable cell. A later local value is shown
 * immediately, but it is not sent until the preceding write settles, so a
 * slow earlier request cannot become the last value stored by the server.
 */
export class LatestValueQueue<T> {
  private readonly cells = new Map<string, {
    version: number;
    confirmed: T;
    tail: Promise<void>;
  }>();

  submit(
    key: string,
    initial: T,
    desired: T,
    send: () => Promise<T>,
    apply: (value: T) => void,
    onFailure: () => void,
  ): Promise<boolean> {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { version: 0, confirmed: initial, tail: Promise.resolve() };
      this.cells.set(key, cell);
    }
    const version = ++cell.version;
    apply(desired);

    const completion = cell.tail.then(async () => {
      try {
        const saved = await send();
        cell.confirmed = saved;
        if (cell.version === version) apply(saved);
        return true;
      } catch {
        if (cell.version === version) {
          apply(cell.confirmed);
          onFailure();
        }
        return false;
      }
    });
    const tail = completion.then(() => undefined);
    cell.tail = tail;
    void tail.then(() => {
      if (this.cells.get(key) === cell && cell.tail === tail && cell.version === version) {
        this.cells.delete(key);
      }
    });
    return completion;
  }
}
