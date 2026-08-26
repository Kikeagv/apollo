"use client";

import { Drawer } from "@base-ui/react/drawer";
import * as React from "react";

import { cn } from "~/lib/utils";

const Sheet = Drawer.Root;
const SheetTrigger = Drawer.Trigger;
const SheetClose = Drawer.Close;

function SheetContent({
  children,
  className,
  side = "right",
  ...props
}: React.ComponentProps<typeof Drawer.Popup> & {
  side?: "bottom" | "left" | "right" | "top";
}) {
  return (
    <Drawer.Portal>
      <Drawer.Backdrop className="fixed inset-0 z-50 bg-slate-950/30 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <Drawer.Popup
        className={cn(
          "bg-card text-card-foreground fixed z-50 flex max-h-screen flex-col shadow-xl transition-transform duration-200 ease-out outline-none data-[ending-style]:duration-150 data-[ending-style]:ease-in data-[starting-style]:duration-200",
          side === "left" &&
            "inset-y-0 left-0 w-[min(18rem,calc(100vw-2rem))] border-r data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full",
          side === "right" &&
            "inset-y-0 right-0 w-[min(22rem,calc(100vw-2rem))] border-l data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
          side === "top" &&
            "inset-x-0 top-0 border-b data-[ending-style]:-translate-y-full data-[starting-style]:-translate-y-full",
          side === "bottom" &&
            "inset-x-0 bottom-0 border-t data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
          className,
        )}
        data-side={side}
        {...props}
      >
        {children}
        <Drawer.Close
          aria-label="Cerrar panel"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/30 absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-lg text-lg leading-none transition-colors focus-visible:ring-3 focus-visible:outline-none"
        >
          <span aria-hidden="true">×</span>
        </Drawer.Close>
      </Drawer.Popup>
    </Drawer.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-6", className)}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-foreground text-lg font-semibold", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
