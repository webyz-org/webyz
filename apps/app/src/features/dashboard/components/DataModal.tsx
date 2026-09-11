import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import type { Column } from "../types";

type Props<T> = {
  title: string;
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  /** Makes rows clickable; used to apply drill-down filters. */
  onRowClick?: (item: T) => void;
};

export function DataModal<T extends { name?: string }>({
  title,
  columns,
  data,
  isLoading,
  onRowClick,
}: Props<T>) {
  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
      </DialogHeader>

      <div className="mt-4 max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-black/5 dark:bg-white/10" />
            ))}
          </div>
        ) : !data.length ? (
          <p className="py-8 text-center text-sm text-text-muted">
            No data for this period
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                {columns.map((col) => (
                  <th key={col.key} className="py-2 font-medium text-text-secondary">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {data.map((item, index) => {
                const clickable = Boolean(onRowClick && item.name);
                return (
                  <tr
                    key={`${item.name ?? "row"}-${index}`}
                    onClick={clickable ? () => onRowClick!(item) : undefined}
                    className={
                      "border-b " +
                      (clickable
                        ? "cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]")
                    }
                  >
                    {columns.map((col) => (
                      <td key={col.key} className="py-2">
                        {col.render(item)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </DialogContent>
  );
}
