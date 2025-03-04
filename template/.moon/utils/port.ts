export class PortAssigner {
    #last?: number
    constructor(public readonly start: number) {}

    next() {
        const next = this.#last == null ? this.start : this.#last + 1
        if (next >= this.start + 100) {
            throw new Error("No more ports available")
        }
        this.#last = next
        return next
    }
}
