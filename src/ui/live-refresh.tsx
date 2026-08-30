"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The client half of the refresh loop, and the only island on the page.
 *
 * It receives a signal that carries no data and answers it by asking the server
 * to re-render. Everything the operator is looking at is server markup that
 * React then reconciles in place, so a card being read is not rebuilt
 * underneath the reader and the scroll position survives the update.
 *
 * `EventSource` reconnects on its own, which is what lets a restarted server
 * heal without anyone reloading the page.
 */
export function LiveRefresh({ endpoint }: { endpoint: string }) {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource(endpoint);
    const refresh = () => router.refresh();
    source.addEventListener("fleet-changed", refresh);
    return () => source.close();
  }, [endpoint, router]);

  return null;
}
