import type * as React from "react";

import { cn } from "~/lib/utils";

type ProgressProps = React.ComponentProps<"div"> & {
  max?: number;
  value?: number;
};

function Progress({
  className,
  max = 100,
  value = 0,
  ...props
}: ProgressProps) {
  const accessibleMax = Math.max(max, 1);
  const accessibleValue = Math.min(Math.max(value, 0), accessibleMax);
  const percentage = Math.min(
    Math.max((accessibleValue / accessibleMax) * 100, 0),
    100,
  );

  return (
    <div
      aria-valuemax={accessibleMax}
      aria-valuemin={0}
      aria-valuenow={accessibleValue}
      className={cn(
        "bg-muted h-2 w-full overflow-hidden rounded-full",
        className,
      )}
      data-slot="progress"
      role="progressbar"
      {...props}
    >
      <div
        className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
        data-slot="progress-indicator"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export { Progress };
