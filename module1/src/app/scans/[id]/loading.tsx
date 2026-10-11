export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse space-y-6" aria-busy="true" aria-label="Loading report">
      <div className="h-16 w-2/3 rounded bg-panel" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="h-64 rounded-lg bg-panel" />
        <div className="h-64 rounded-lg bg-panel" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="h-96 rounded-lg bg-panel" />
        <div className="h-96 rounded-lg bg-panel" />
      </div>
    </div>
  );
}
