import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="num text-micro uppercase tracking-[0.12em] text-mute">404</p>
      <h1 className="text-xl font-semibold">This page is not on the map</h1>
      <Link href="/map" className="rounded border border-line px-4 py-2 text-sm hover:border-amber">
        Open the Shift Map
      </Link>
    </main>
  );
}
