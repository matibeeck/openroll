/** Playback clock in score seconds. Pure: time comes from an injected `now()` (seconds). */
export class Transport {
  private base = 0;
  private startedAt = 0;
  private _playing = false;
  private _speed = 1;
  loopA: number | null = null;
  loopB: number | null = null;

  constructor(
    private readonly now: () => number,
    public duration = Infinity,
  ) {}

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  /** Current position in score seconds (applies the A-B loop). */
  get time(): number {
    let t = this._playing ? this.base + (this.now() - this.startedAt) * this._speed : this.base;
    const { loopA: a, loopB: b } = this;
    if (a !== null && b !== null && b > a && t >= b) {
      t = a + ((t - a) % (b - a));
      // Re-anchor so the wrap is stable.
      this.base = t;
      this.startedAt = this.now();
    }
    if (t >= this.duration) {
      t = this.duration;
      if (this._playing) this.pause();
    }
    return Math.max(0, t);
  }

  play(): void {
    if (this._playing) return;
    if (this.base >= this.duration) this.base = this.loopA ?? 0;
    this.startedAt = this.now();
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.base = this.time;
    this._playing = false;
  }

  seek(t: number): void {
    this.base = Math.max(0, Math.min(t, this.duration));
    this.startedAt = this.now();
  }

  /** 0.25–1.5 (25–150%). Notes are triggered individually, so pitch never changes. */
  setSpeed(s: number): void {
    const t = this.time;
    this._speed = Math.min(1.5, Math.max(0.25, s));
    this.base = t;
    this.startedAt = this.now();
  }

  setLoop(a: number | null, b: number | null): void {
    this.loopA = a;
    this.loopB = b;
  }

  /** Wait mode: freeze the clock at `t` without pausing the session. */
  hold(t: number): void {
    this.base = t;
    this.startedAt = this.now();
  }
}
