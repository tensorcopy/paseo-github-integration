import type { BoardRow } from "../lib/sort";

/**
 * What the board's list actually renders: a card, or the host heading that
 * opens a run of cards from one GitHub host. Headings exist only when the
 * board is aggregating more than one host — with a single account there is
 * nothing to divide, and a lone "github.com" banner is just noise.
 */
export type ListRow =
  | { kind: "host"; key: string; host: string; count: number }
  | { kind: "row"; key: string; row: BoardRow };

/**
 * Groups already-sorted rows by host without disturbing the order within a
 * group. Hosts appear in the order their first row does, so whichever host
 * owns the top card by the active sort keeps the top of the list rather than
 * losing it to an alphabetical rule the sort dropdown never mentions.
 */
export function withHostHeaders(rows: readonly BoardRow[]): ListRow[] {
  const order: string[] = [];
  const byHost = new Map<string, BoardRow[]>();
  for (const row of rows) {
    const existing = byHost.get(row.item.host);
    if (existing === undefined) {
      byHost.set(row.item.host, [row]);
      order.push(row.item.host);
    } else {
      existing.push(row);
    }
  }

  if (order.length < 2) {
    return rows.map((row) => ({ kind: "row", key: row.item.id, row }));
  }

  const list: ListRow[] = [];
  for (const host of order) {
    const group = byHost.get(host) ?? [];
    list.push({ kind: "host", key: `host:${host}`, host, count: group.length });
    for (const row of group) list.push({ kind: "row", key: row.item.id, row });
  }
  return list;
}
