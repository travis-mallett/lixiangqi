import { randomToken } from './algo';
import { storage } from './storage';

// Shared by presence and traffic; neither creates a second browser identity.
export function browserId(): string {
  const key = 'presence.visitor';
  const existing = storage.get(key);
  if (existing) return existing;
  const value = randomToken();
  storage.set(key, value);
  return value;
}
