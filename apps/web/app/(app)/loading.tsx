export default function AppLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      </div>
    </div>
  );
}
