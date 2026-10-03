export function readOnlyProp<A>(value: A): () => A {
  return () => value;
}
