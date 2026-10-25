import type { BufferGeometry } from 'three';

export function triangleCount(geometry: BufferGeometry) {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}
