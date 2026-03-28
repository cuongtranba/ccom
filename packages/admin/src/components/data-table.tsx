import { useState, Fragment } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  expandable?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T>({
  columns, data, keyFn, expandable, emptyMessage = "No data", loading,
}: DataTableProps<T>) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {expandable && <TableHead className="w-8" />}
          {columns.map((col) => (
            <TableHead key={col.header} className={col.className}>{col.header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const key = keyFn(row);
          const isExpanded = expandedKeys.has(key);
          return (
            <Fragment key={key}>
              <TableRow
                className={expandable ? "cursor-pointer hover:bg-muted/50" : undefined}
                onClick={expandable ? () => toggleExpand(key) : undefined}
              >
                {expandable && (
                  <TableCell className="w-8 pr-0">
                    <svg
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                        isExpanded && "rotate-90",
                      )}
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M6 3l5 5-5 5V3z" />
                    </svg>
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell key={col.header} className={col.className}>
                    {typeof col.accessor === "function"
                      ? col.accessor(row)
                      : (row[col.accessor] as React.ReactNode)}
                  </TableCell>
                ))}
              </TableRow>
              {expandable && isExpanded && (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="bg-muted/30 p-4">
                    {expandable(row)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
