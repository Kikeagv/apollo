"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Menu as MenuIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { Sheet, SheetContent, SheetTitle } from "./sheet";

type SidebarContextValue = {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  state: "collapsed" | "expanded";
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (context === null) {
    throw new Error("useSidebar debe usarse dentro de SidebarProvider");
  }
  return context;
}

function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  onOpenChange,
  open: openProp,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const [openMobile, setOpenMobile] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const open = openProp ?? openState;

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) setOpenState(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, openProp],
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
    } else {
      setOpen(!open);
    }
  }, [isMobile, open, setOpen]);

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state: open ? "expanded" : "collapsed",
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        className={cn(
          "group/sidebar-wrapper has-[[data-variant=inset]]:bg-muted/30 flex min-h-svh w-full",
          className,
        )}
        data-sidebar-state={value.state}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  children,
  className,
  side = "left",
  ...props
}: React.ComponentProps<"aside"> & {
  side?: "left" | "right";
}) {
  const { isMobile, openMobile, setOpenMobile, state } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          aria-label="Navegación principal"
          className="bg-card w-[min(18rem,calc(100vw-2rem))] gap-0 p-0"
          side={side}
        >
          <SheetTitle className="sr-only">Navegación principal</SheetTitle>
          <div
            className={cn("flex h-full min-h-0 flex-col", className)}
            data-sidebar="sidebar"
            data-state="expanded"
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        "border-border bg-card text-card-foreground sticky top-0 z-40 hidden h-svh shrink-0 flex-col transition-[width] duration-200 ease-out md:flex",
        state === "expanded" ? "w-64" : "w-16",
        className,
      )}
      data-sidebar="sidebar"
      data-side={side}
      data-state={state}
      {...props}
    >
      <div className="flex min-h-0 flex-1 flex-col border-r">{children}</div>
    </aside>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-16 items-center px-3 py-4", className)}
      data-sidebar="header"
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto px-3 py-4", className)}
      data-sidebar="content"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-auto p-3", className)}
      data-sidebar="footer"
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative flex w-full min-w-0 flex-col", className)}
      data-sidebar="group"
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { state } = useSidebar();
  return (
    <div
      className={cn(
        "text-muted-foreground flex h-8 items-center rounded-md px-3 text-xs font-semibold tracking-[0.08em] uppercase transition-[padding,opacity]",
        state === "collapsed" && "justify-center px-0 text-[0px]",
        className,
      )}
      data-sidebar="group-label"
      {...props}
    />
  );
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      data-sidebar="menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative min-w-0", className)}
      data-sidebar="menu-item"
      {...props}
    />
  );
}

function SidebarMenuButton({
  asChild = false,
  children,
  className,
  isActive = false,
  tooltip,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string;
}) {
  const { state } = useSidebar();
  const buttonClassName = cn(
    "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/30 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none transition-[background-color,color,padding] focus-visible:ring-3",
    isActive && "bg-primary/10 text-primary font-semibold",
    state === "collapsed" && "[&_.sidebar-label]:hidden justify-center px-0",
    className,
  );

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      "aria-current"?: "page";
      className?: string;
      "data-active"?: string;
      "data-sidebar"?: string;
      title?: string;
    }>;
    return React.cloneElement(child, {
      "aria-current": isActive ? "page" : undefined,
      className: cn(buttonClassName, child.props.className),
      "data-active": isActive ? "true" : "false",
      "data-sidebar": "menu-button",
      title: state === "collapsed" ? tooltip : undefined,
    });
  }

  return (
    <button
      className={buttonClassName}
      data-active={isActive ? "true" : "false"}
      data-sidebar="menu-button"
      title={state === "collapsed" ? tooltip : undefined}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const { state } = useSidebar();
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none absolute right-2 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium",
        state === "collapsed" && "hidden",
        className,
      )}
      data-sidebar="menu-badge"
      {...props}
    />
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { state, toggleSidebar } = useSidebar();
  return (
    <button
      aria-label={
        state === "expanded" ? "Colapsar navegación" : "Expandir navegación"
      }
      className={cn(
        "bg-card hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/30 absolute top-3 -right-5 z-40 hidden size-10 items-center justify-center rounded-full border shadow-sm outline-none focus-visible:ring-3 md:flex",
        className,
      )}
      onClick={toggleSidebar}
      type="button"
      {...props}
    >
      {state === "expanded" ? (
        <ChevronLeft aria-hidden="true" className="size-3.5" />
      ) : (
        <ChevronRight aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "bg-background relative flex min-h-svh min-w-0 flex-1 flex-col",
        className,
      )}
      data-sidebar="inset"
      {...props}
    />
  );
}

function SidebarTrigger({
  className,
  ...props
}: React.ComponentProps<"button">) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  return (
    <button
      aria-expanded={isOpen}
      aria-label={isOpen ? "Cerrar navegación" : "Abrir navegación"}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/30 inline-flex size-10 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-3",
        className,
      )}
      onClick={toggleSidebar}
      type="button"
      {...props}
    >
      <MenuIcon aria-hidden="true" className="size-5" />
      <span className="sr-only">{isOpen ? "Cerrar" : "Abrir"} navegación</span>
    </button>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
};
