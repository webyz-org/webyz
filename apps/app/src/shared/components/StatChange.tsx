/**
 * Period-over-period change on the site sub-pages' stat cards: "+12%" or
 * "-8%", green when the move is good and red when it is bad. `good` defaults
 * to "up is good"; pass it for metrics where a rise is bad (search
 * position). The Overview's TopStats tiles draw their own arrow badge.
 */
export default function StatChange({
  delta,
  text,
  good = delta > 0,
}: {
  /** Signed change; its sign picks the prefix, and without `text` it is shown. */
  delta: number;
  /** Magnitude to show instead of `${|delta|}%`, e.g. points for a rate. */
  text?: string;
  good?: boolean;
}) {
  return (
    <span className={"text-xs font-medium " + (good ? "text-trend-up" : "text-trend-down")}>
      {delta > 0 ? "+" : "-"}
      {text ?? `${Math.abs(delta)}%`}
    </span>
  );
}

/** For a value that had nothing in the previous period to compare with. */
export const NewBadge = () => <span className="text-xs font-medium text-trend-up">new</span>;
