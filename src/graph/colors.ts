/** Lane palette: distinct hues that read well on both dark and light backgrounds. */
export const LANE_COLORS = [
  "#5b9cf6", // blue
  "#f28b5c", // orange
  "#4ec9a6", // teal
  "#c586e0", // purple
  "#e9c46a", // yellow
  "#f06c8c", // pink
  "#7fb069", // green
  "#5fd0e0", // cyan
  "#d39b6b", // tan
  "#9aa5f5", // periwinkle
];

export function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length];
}
