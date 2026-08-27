"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Inbox,
  LogOut,
  Settings2,
  ShieldCheck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import {
  panaceaRoleLabel,
  type PanaceaDestination,
  visiblePanaceaDestinations,
} from "~/domain/panacea-shell";
import { authClient } from "~/server/better-auth/client";
import { ClinicSessionActivity } from "./clinic-session-activity";
import { SupportAccessSection } from "./support-access-section";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "~/components/ui/sidebar";

type PanaceaShellProps = {
  children: React.ReactNode;
  clinic: {
    clinicName: string;
    role: "doctor" | "owner" | "secretary";
  };
  user: {
    email: string;
    name: string;
  };
};

export function PanaceaShell({ children, clinic, user }: PanaceaShellProps) {
  return (
    <SidebarProvider>
      <PanaceaNavigation role={clinic.role} />
      <SidebarInset>
        <ClinicSessionActivity />
        <PanaceaHeader clinic={clinic} user={user} />
        <div className="border-border bg-background border-b px-4 py-3 sm:px-6">
          <SupportAccessSection />
        </div>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function PanaceaNavigation({
  role,
}: {
  role: PanaceaShellProps["clinic"]["role"];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const destinations = visiblePanaceaDestinations(role);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeOnNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar aria-label="Navegación principal">
      <SidebarHeader>
        <Link
          aria-label="Praxia, ir al Calendario"
          className="focus-visible:border-ring focus-visible:ring-ring/30 flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3"
          href="/calendario"
          onClick={closeOnNavigate}
        >
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
          >
            P
          </span>
          <span className={state === "collapsed" ? "sr-only" : "min-w-0"}>
            <span className="block truncate text-sm font-semibold">Praxia</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operación clínica</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {destinations.map((destination) => (
                <SidebarMenuItem key={destination.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(destination.href)}
                    tooltip={destination.label}
                  >
                    <Link href={destination.href} onClick={closeOnNavigate}>
                      <DestinationIcon destination={destination.id} />
                      <span className="sidebar-label">{destination.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          <span className={state === "collapsed" ? "sr-only" : undefined}>
            Sesión clínica protegida
          </span>
        </div>
        <SidebarRail />
      </SidebarFooter>
    </Sidebar>
  );
}

function DestinationIcon({ destination }: { destination: PanaceaDestination }) {
  const Icon: LucideIcon =
    destination === "calendar"
      ? CalendarDays
      : destination === "patients"
        ? UsersRound
        : destination === "pending"
          ? Inbox
          : Settings2;
  return <Icon aria-hidden="true" className="size-4 shrink-0" />;
}

function PanaceaHeader({
  clinic,
  user,
}: {
  clinic: PanaceaShellProps["clinic"];
  user: PanaceaShellProps["user"];
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();

  function signOut() {
    setSignOutError(undefined);
    setIsSigningOut(true);
    void authClient
      .signOut()
      .then(() => window.location.assign("/"))
      .catch(() => {
        setIsSigningOut(false);
        setSignOutError("No se pudo cerrar la sesión. Inténtelo de nuevo.");
      });
  }

  return (
    <header className="border-border bg-card/95 sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <SidebarTrigger className="md:hidden" />
        <div className="min-w-0">
          <p className="text-muted-foreground text-[0.68rem] font-semibold tracking-[0.12em] uppercase">
            Clínica
          </p>
          <p className="truncate text-sm font-semibold sm:text-base">
            {clinic.clinicName}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div
          aria-label="Sesión de clínica activa"
          className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 sm:px-3"
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-emerald-600"
          />
          Sesión activa
        </div>
        <span className="text-muted-foreground text-xs sm:text-sm">
          {panaceaRoleLabel(clinic.role)}
        </span>
        {signOutError ? (
          <p
            aria-live="polite"
            className="text-destructive max-w-44 text-xs"
            role="alert"
          >
            {signOutError}
          </p>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Cuenta de ${user.name}`}
            className="hover:bg-muted inline-flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3"
          >
            <UserRound aria-hidden="true" className="size-4" />
            <span className="hidden max-w-36 truncate sm:inline">
              {user.name}
            </span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>
              <span className="block truncate">{user.name}</span>
              <span className="text-muted-foreground/80 mt-0.5 block truncate font-normal">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <ShieldCheck aria-hidden="true" className="mr-2 size-4" />
              Sesión de clínica activa
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isSigningOut} onClick={signOut}>
              <LogOut aria-hidden="true" className="mr-2 size-4" />
              {isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
