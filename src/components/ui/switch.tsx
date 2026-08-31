import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

/**
 * Switch compartido para las políticas de Atención por WhatsApp.
 * El ticket requiere un toggle accesible; este wrapper añade el tratamiento
 * visual tokenizado de Panacea al primitive de Base UI y conserva su input.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "bg-input/80 data-checked:bg-primary focus-visible:border-ring focus-visible:ring-ring/30 relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-1 shadow-xs transition-[background-color,box-shadow] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background pointer-events-none block size-9 rounded-full shadow-sm transition-transform duration-150 ease-out data-checked:translate-x-3 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
