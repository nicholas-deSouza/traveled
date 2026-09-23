const palette = ['#C44F35', '#287F8E', '#7763AD', '#B17816', '#367852', '#B84878', '#426EC1', '#866143'];
export function tripColor(trip: { id: string; color?: string | null }): string {
  if (trip.color && /^#[0-9a-f]{6}$/i.test(trip.color)) return trip.color;
  let hash = 0;
  for (const char of trip.id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
