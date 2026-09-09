/**
 * Plays audio for a single-ply replay transition. Forward navigation keeps the
 * caller's move-specific cue; backward navigation uses the base move cue
 * because the destination no longer describes the move being undone.
 */
export function playMoveNavigationSound(fromPly: number, toPly: number, playForward: () => void): void {
  const delta = toPly - fromPly;
  if (delta === 1) playForward();
  else if (delta === -1) site.sound.move();
}
