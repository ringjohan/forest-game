import type { Vector3 } from "three";

export const SWORD_SWING_SECONDS = 0.24;
export const SWORD_COOLDOWN_SECONDS = 0.28;
export const PLAYER_RADIUS = 0.38;
export const WEREWOLF_RADIUS = 0.65;

export function segmentSphereHit(start: Vector3, end: Vector3, center: Vector3, radius: number): number | null {
  const direction = end.clone().sub(start);
  const offset = start.clone().sub(center);
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const a = direction.lengthSq();
  if (a === 0) return null;
  const b = offset.dot(direction);
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
