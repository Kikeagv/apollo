"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import * as React from "react";

import { cn } from "~/lib/utils";

const Accordion = AccordionPrimitive.Root;

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("border-border rounded-xl border", className)}
      {...props}
    />
  );
}

function AccordionHeader({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Header>) {
  return (
    <AccordionPrimitive.Header className={cn("flex", className)} {...props} />
  );
}

function AccordionTrigger({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Trigger
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/30 hover:bg-muted/40 flex min-h-16 w-full items-start justify-between gap-3 rounded-xl p-4 text-left transition-colors outline-none focus-visible:ring-3 data-[open]:rounded-b-none",
        className,
      )}
      {...props}
    />
  );
}

function AccordionPanel({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel>) {
  return (
    <AccordionPrimitive.Panel
      className={cn(
        "border-border data-[ending-style]:animate-out data-[starting-style]:animate-in border-t px-4 pt-4 pb-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
};
