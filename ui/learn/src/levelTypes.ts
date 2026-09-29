export interface Shape {
  orig: Key;
  dest?: Key;
  color?: string;
}

export type CgMove = {
  orig: Key;
  dest: Key;
};
