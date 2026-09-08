const reasons: Record<string, [string, string]> = {
  'perpetual-check': [
    'Perpetual check limit reached. Choose a different continuation.',
    '长将已达上限，请变招。',
  ],
  'perpetual-chase': [
    'Perpetual chase limit reached. Choose a different continuation.',
    '长捉已达上限，请变招。',
  ],
  'alternating-check-chase': [
    'Alternating check/chase limit reached. Choose a different continuation.',
    '将捉交替已达上限，请变招。',
  ],
  'forced-variation': [
    'Loss: no permitted continuation after the forced variation limit.',
    '负：禁招后无允许着法。',
  ],
  'no-attacking-material': ['Draw: neither side has attacking material.', '和棋：双方无进攻子力。'],
  'no-capture': ['Draw: 120 counted plies without a capture.', '和棋：自然限着120步未吃子。'],
  'move-limit': ['Draw: 400 plies played.', '和棋：总步数达到400步。'],
  repetition: ['Draw: fivefold repetition.', '和棋：局面重复五次。'],
  'mutual-check': ['Draw: mutual perpetual check.', '和棋：双方互相长将。'],
  'mutual-chase': ['Draw: mutual perpetual chase.', '和棋：双方互相长捉。'],
  stalemate: ['Win by stalemate.', '困毙，判胜。'],
};

export function adjudicationText(reason?: string | null): string | undefined {
  return reason ? reasons[reason]?.[document.documentElement.lang.startsWith('zh') ? 1 : 0] : undefined;
}

// The server's legacy `mate` status also represents a Xiangqi stalemate win.
// Prefer the actual ending, with check state as a fallback for older game data.
export function isXiangqiCheckmate(status?: string, termination?: string | null, check?: boolean): boolean {
  return status === 'mate' && (termination ? termination === 'checkmate' : check !== false);
}
