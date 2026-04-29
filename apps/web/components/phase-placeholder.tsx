import Link from "next/link";

interface PhasePlaceholderProps {
  title: string;
  eyebrow: string;
  body: string;
  items: string[];
}

export function PhasePlaceholder({
  title,
  eyebrow,
  body,
  items,
}: PhasePlaceholderProps) {
  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center bg-surface px-4 py-8">
      <section className="neo-panel w-full max-w-3xl p-6 sm:p-10">
        <p className="font-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-display text-3xl font-black uppercase leading-tight tracking-tight text-black sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl font-body text-sm leading-6 text-gray-600">
          {body}
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <div
              key={item}
              className="rounded-lg border-2 border-black bg-white px-3 py-3"
            >
              <p className="font-label text-[10px] font-bold uppercase tracking-wider text-black">
                {item}
              </p>
            </div>
          ))}
        </div>

        <Link
          href="/"
          className="neo-btn-secondary mt-8 inline-flex px-5 py-3 font-display text-xs font-bold uppercase tracking-wider"
        >
          Back to HQ
        </Link>
      </section>
    </main>
  );
}
