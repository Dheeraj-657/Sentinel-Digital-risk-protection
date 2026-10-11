import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <EmptyState
        title="This scan isn't in your history"
        body="It may have been deleted. Open scan history to find another report, or run a new analysis."
        action={
          <Link href="/history" className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-raised">
            Open scan history
          </Link>
        }
      />
    </div>
  );
}
