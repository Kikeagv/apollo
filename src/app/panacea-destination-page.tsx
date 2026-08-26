type PanaceaDestinationPageProps = {
  children: React.ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
};

export function PanaceaDestinationPage({
  children,
  description,
  eyebrow = "Panacea",
  title,
}: PanaceaDestinationPageProps) {
  return (
    <div className="flex w-full flex-col gap-6">
      <header className="max-w-3xl space-y-2">
        <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground leading-6 text-pretty">
          {description}
        </p>
      </header>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  );
}

export function PanaceaDestinationLoading({ title }: { title: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={`Cargando ${title}`}
      className="flex w-full flex-col gap-6"
      role="status"
    >
      <div className="space-y-3">
        <div className="bg-muted h-3 w-24 rounded motion-safe:animate-pulse" />
        <div className="bg-muted h-10 w-64 rounded-lg motion-safe:animate-pulse" />
        <div className="bg-muted h-5 w-full max-w-2xl rounded motion-safe:animate-pulse" />
      </div>
      <div className="bg-muted min-h-72 w-full rounded-xl motion-safe:animate-pulse" />
    </div>
  );
}
