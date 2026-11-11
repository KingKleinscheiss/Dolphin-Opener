import type { Profile, QueueProgress } from '../domain/types.js';

/** Ordered, front-to-back queue built once at run start; never re-ordered mid-run. */
export class ProfileQueue {
  private pending: Profile[];
  private readonly total: number;
  private doneCount = 0;

  constructor(profiles: Profile[]) {
    this.pending = [...profiles];
    this.total = profiles.length;
  }

  isEmpty(): boolean {
    return this.pending.length === 0;
  }

  pop(): Profile | undefined {
    return this.pending.shift();
  }

  /** Puts a profile back at the front — used when no proxy was available to start it. */
  pushFront(profile: Profile): void {
    this.pending.unshift(profile);
  }

  markDone(): void {
    this.doneCount += 1;
  }

  progress(): QueueProgress {
    return {
      total: this.total,
      done: this.doneCount,
      remaining: this.pending.length,
      nextUp: this.pending.slice(0, 5).map((p) => p.name),
    };
  }
}
