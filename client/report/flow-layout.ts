// Where each participant and part sits in the data-flow diagram, worked out from their heights.
//
// The diagram is a row of two columns, each a stack with a fixed gap, centred against the other. Lines are
// drawn from these positions rather than from positions measured with onLayout: on the web, onLayout fires only
// when an element's size changes, so a column that moves (because the other column grew or shrank) or a card
// pushed down by the one above keeps its old position, and every line to it ends in the wrong place.

export type Box = { top: number; bottom: number };

/** A column's boxes from its items' heights, top to bottom with `gap` between them; null until every height is known. */
export function stack(keys: readonly string[], heights: Readonly<Record<string, number>>, gap: number): { boxes: Record<string, Box>; height: number } | null {
  const boxes: Record<string, Box> = {};
  let y = 0;
  for (const key of keys) {
    const height = heights[key];
    if (height === undefined) return null;
    boxes[key] = { top: y, bottom: y + height };
    y += height + gap;
  }
  return { boxes, height: keys.length ? y - gap : 0 };
}

/**
 * Two stacks side by side, each centred in the row (its `alignItems: "center"`), in the row's coordinates. The row is
 * as tall as the taller stack, or `rowHeight` when something beside it stretches it taller.
 */
export function centred(left: { boxes: Record<string, Box>; height: number }, right: { boxes: Record<string, Box>; height: number }, rowHeight = 0): { left: Record<string, Box>; right: Record<string, Box> } {
  const row = Math.max(rowHeight, left.height, right.height);
  const shift = (column: { boxes: Record<string, Box>; height: number }) => {
    const offset = (row - column.height) / 2;
    return Object.fromEntries(Object.entries(column.boxes).map(([key, box]) => [key, { top: box.top + offset, bottom: box.bottom + offset }]));
  };
  return { left: shift(left), right: shift(right) };
}
