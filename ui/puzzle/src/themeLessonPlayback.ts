export const lessonMoveMillis = 1000;
export const lessonMateMillis = 5000;

/** A fixed teaching line needs no engine or server requests during playback. */
export class ThemeLessonPlayback {
  private timer?: ReturnType<typeof setTimeout>;
  private ply = 0;

  constructor(
    private readonly moveCount: number,
    private readonly render: (ply: number) => void,
    private readonly animationMillis: number,
  ) {}

  start(): void {
    this.stop();
    this.ply = 0;
    this.render(0);
    this.resume();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  resume(): void {
    this.stop();
    this.timer = setTimeout(
      () => {
        this.ply = (this.ply + 1) % (this.moveCount + 1);
        this.render(this.ply);
        this.resume();
      },
      this.ply === this.moveCount ? this.animationMillis + lessonMateMillis : lessonMoveMillis,
    );
  }
}
