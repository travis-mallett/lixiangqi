// These are not true quantities. They represent the value of input elements
export type InputValue = number;
// Visible value computed from the input value
export type RealValue = number;

export interface ClockConfig {
  lim: number;
  inc: number;
  moveTime?: MoveTimeLimitConfig;
}

export interface MoveTimeLimitConfig {
  seconds: number;
  first?: {
    moves: number;
    seconds: number;
  };
}
