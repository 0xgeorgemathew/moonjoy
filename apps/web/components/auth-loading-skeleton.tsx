export function AuthLoadingSkeleton() {
  return (
    <div className="flex h-full animate-pulse flex-col items-center justify-center gap-4">
      <div className="h-8 w-48 rounded bg-foreground/10" />
      <div className="h-4 w-32 rounded bg-foreground/5" />
    </div>
  );
}
