import { useRealtime } from "../hooks/useDashboard";

/**
 * Live visitor count, polled every 15s. Plain text with a status dot rather
 * than a pill, so it sits quietly in the dashboard's control row.
 */
export default function RealtimeBadge({ siteId }: { siteId?: string }) {
  const { data, isLoading } = useRealtime(siteId);

  const count = data?.current_visitors ?? 0;
  const live = count > 0;

  return (
    <div
      className="flex items-center gap-2 text-sm text-text-secondary"
      title="Visitors in the last 5 minutes"
    >
      <span className="relative flex h-2 w-2">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
        )}
        <span
          className={
            "relative inline-flex h-2 w-2 rounded-full " +
            (live ? "bg-success" : "bg-text-muted")
          }
        />
      </span>
      <span>
        <span className="font-medium text-text-primary">
          {isLoading ? "-" : count}
        </span>{" "}
        current visitor{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
