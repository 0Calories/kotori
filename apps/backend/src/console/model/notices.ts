/** A warning or error a service logged, such as an approval email that didn't send. */
export interface Notice {
  readonly level: "warn" | "error"
  readonly text: string
}

/**
 * Notices from the console's services to its screen. Services can log before the screen is up, so
 * notices wait until something listens.
 */
export class Notices {
  private readonly waiting: Array<Notice> = []
  private readonly listeners = new Set<(notice: Notice) => void>()

  readonly emit = (notice: Notice) => {
    if (this.listeners.size === 0) this.waiting.push(notice)
    for (const listener of this.listeners) listener(notice)
  }

  readonly subscribe = (listener: (notice: Notice) => void) => {
    this.listeners.add(listener)
    for (const notice of this.waiting.splice(0)) listener(notice)
    return () => void this.listeners.delete(listener)
  }
}
