"use client";

import { Menu } from "@base-ui/react/menu";
import * as React from "react";

import { cn } from "~/lib/utils";

const DropdownMenu = Menu.Root;

function DropdownMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Trigger>) {
  return (
    <Menu.Trigger
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/30 outline-none focus-visible:ring-3",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuContent({
  align = "end",
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof Menu.Popup> & {
  align?: "center" | "end" | "start";
  sideOffset?: number;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={sideOffset}>
        <Menu.Popup
          className={cn(
            "bg-popover text-popover-foreground z-50 min-w-48 origin-(--transform-origin) rounded-xl border p-1.5 shadow-lg transition-[opacity,transform] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "focus:bg-muted data-highlighted:bg-muted focus-visible:border-ring focus-visible:ring-ring/30 flex min-h-10 cursor-default items-center rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-muted-foreground px-3 py-2 text-xs font-semibold",
        className,
      )}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      className={cn("bg-border my-1 h-px", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
