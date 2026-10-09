"use client";
import { ErrorState, Button } from "@/components/ui/primitives";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /no such table|SQLITE|database/i.test(error.message);
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <ErrorState
        title={db ? "The scan database isn't ready" : "This page couldn't load"}
        body={
          db
            ? "Run `npm run setup` in the project folder to create the database and load the demo data, then reload."
            : "Something failed while loading this page. Try again; if it keeps happening, check the server log."
        }
        action={
          <Button variant="ghost" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
