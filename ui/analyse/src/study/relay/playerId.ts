import type { StudyPlayer } from '../interfaces';

export const playerId = (p: StudyPlayer) => p.playerId || p.name;
