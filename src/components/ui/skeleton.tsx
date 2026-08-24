import { cn } from "~/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted rounded-lg motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
