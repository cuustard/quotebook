"use client";

/**
 * Small, dependency-free chart primitives.
 *
 * Deliberately CSS/flex rather than SVG: these shapes are all rectangles, and
 * flexbox gives responsive sizing for free without viewBox arithmetic. Keeps
 * the bundle exactly as big as it was and lets the charts inherit the app's
 * palette directly.
 *
 * Every mark accepts an optional `href`, which turns it into a real anchor
 * that deep-links into the filtered feed. Anchors (rather than click
 * handlers) mean middle-click, cmd-click and keyboard focus all work for
 * free, and a mark with no href stays inert.
 */

import Link from "next/link";
import { cn } from "@/lib/cn";
import { pairKey } from "@/lib/stats";

/** Wraps children in a Link only when there's somewhere to go. */
function MaybeLink({
  href,
  className,
  title,
  style,
  children,
}: {
  href?: string;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <div className={className} title={title} style={style}>
        {children}
      </div>
    );
  }
  return (
    <Link href={href} className={className} title={title} style={style}>
      {children}
    </Link>
  );
}

/** Headline number with a label underneath. */
export function StatTile({
  value,
  label,
  hint,
  href,
}: {
  value: string | number;
  label: string;
  hint?: string;
  href?: string;
}) {
  return (
    <MaybeLink
      href={href}
      title={href ? "Show these quotes" : undefined}
      className={cn(
        "qb-card block px-4 py-3",
        href && "transition hover:border-accent/40 hover:bg-white/[0.03]",
      )}
    >
      <div className="font-heading text-2xl font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
      {hint && <div className="mt-0.5 truncate text-[0.7rem] text-ink-muted/60">{hint}</div>}
    </MaybeLink>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="qb-card p-4">
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[0.7rem] text-ink-muted/70">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Vertical columns. Bars share the full width, so this handles both a 7-bar
 * weekday chart and a 150-bar monthly timeline without configuration.
 */
export function ColumnChart({
  data,
  height = 120,
  labelEvery = 1,
  formatTooltip,
}: {
  data: Array<{ key: string; label: string; count: number; href?: string }>;
  height?: number;
  /** Show an axis label every Nth column (thins out long timelines). */
  labelEvery?: number;
  formatTooltip?: (d: { label: string; count: number }) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex items-end gap-px" style={{ height }}>
        {data.map((d) => {
          // An empty bucket has nothing to show, so it never links.
          const href = d.count > 0 ? d.href : undefined;
          return (
            <MaybeLink
              key={d.key}
              href={href}
              title={formatTooltip ? formatTooltip(d) : `${d.label}: ${d.count}`}
              className={cn("group relative h-full flex-1", href && "cursor-pointer")}
            >
              <div
                className={cn(
                  "absolute bottom-0 w-full rounded-t-[2px] transition-colors",
                  d.count > 0 ? "bg-accent/75" : "bg-white/[0.06]",
                  href && "group-hover:bg-accent",
                )}
                style={{
                  height: d.count > 0 ? `${Math.max(3, (d.count / max) * 100)}%` : "2px",
                }}
              />
            </MaybeLink>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-px text-[0.6rem] text-ink-muted/60">
        {data.map((d, i) => (
          <div key={d.key} className="flex-1 overflow-hidden text-center">
            {i % labelEvery === 0 ? d.label : " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal ranked bars — for leaderboards where names need room. */
export function BarList({
  data,
  formatValue = (n) => String(n),
}: {
  data: Array<{ key: string; label: string; count: number; sub?: string; href?: string }>;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.key}>
          <MaybeLink
            href={d.href}
            title={d.href ? `Show ${d.label}'s quotes` : undefined}
            className={cn(
              "block rounded-md",
              d.href && "group -mx-1.5 px-1.5 py-1 transition hover:bg-white/[0.04]",
            )}
          >
            <div className="mb-0.5 flex items-baseline justify-between gap-3 text-sm">
              <span
                className={cn(
                  "min-w-0 truncate text-ink",
                  d.href && "group-hover:text-accent",
                )}
              >
                {d.label}
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {formatValue(d.count)}
                {d.sub && (
                  <span className="ml-1.5 text-[0.7rem] text-ink-muted/60">· {d.sub}</span>
                )}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className={cn(
                  "h-full rounded-full bg-accent/75 transition-colors",
                  d.href && "group-hover:bg-accent",
                )}
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
          </MaybeLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lower-triangular co-occurrence grid. A full matrix would mirror every cell,
 * so only the meaningful half is drawn.
 */
export function PairMatrix({
  names,
  counts,
  hrefFor,
}: {
  names: string[];
  /** Keyed by `pairKey(a, b)` — never build these keys by hand. */
  counts: Map<string, number>;
  hrefFor?: (a: string, b: string) => string;
}) {
  const max = Math.max(1, ...counts.values());
  const short = (n: string) => n.split(" ")[0];
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[0.7rem]">
        <tbody>
          {names.slice(1).map((row, ri) => (
            <tr key={row}>
              <th className="pr-2 text-right font-normal text-ink-muted whitespace-nowrap">
                {short(row)}
              </th>
              {names.slice(0, ri + 1).map((col) => {
                const count = counts.get(pairKey(col, row)) ?? 0;
                const href = count > 0 && hrefFor ? hrefFor(col, row) : undefined;
                return (
                  <td key={col}>
                    <MaybeLink
                      href={href}
                      title={
                        href
                          ? `${row} + ${col}: ${count} — show these quotes`
                          : `${row} + ${col}: ${count}`
                      }
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded",
                        count === 0 && "bg-white/[0.04] text-transparent",
                        href && "transition hover:ring-2 hover:ring-accent",
                      )}
                      // Intensity shading: denser pairs get a stronger fill.
                      style={
                        count > 0
                          ? { backgroundColor: `rgba(88, 101, 242, ${0.14 + (count / max) * 0.66})` }
                          : undefined
                      }
                    >
                      <span
                        className={cn(
                          "tabular-nums",
                          count / max > 0.55 ? "text-white" : "text-ink",
                        )}
                      >
                        {count || ""}
                      </span>
                    </MaybeLink>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th />
            {names.slice(0, -1).map((col) => (
              <th key={col} className="pt-1 text-center font-normal text-ink-muted">
                <span className="block w-8 truncate">{short(col)}</span>
              </th>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Gantt-style first→last appearance strips on a shared timeline. */
export function SpanChart({
  rows,
  from,
  to,
}: {
  rows: Array<{ name: string; first: string; last: string; href?: string }>;
  from: string;
  to: string;
}) {
  const toMs = (d: string) =>
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const start = toMs(from);
  const total = Math.max(1, toMs(to) - start);
  const pct = (d: string) => ((toMs(d) - start) / total) * 100;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const left = pct(r.first);
        const width = Math.max(1.2, pct(r.last) - left);
        return (
          <MaybeLink
            key={r.name}
            href={r.href}
            title={
              r.href
                ? `${r.name}: ${r.first} → ${r.last} — show their quotes`
                : `${r.name}: ${r.first} → ${r.last}`
            }
            className={cn(
              "flex items-center gap-3 rounded-md",
              r.href && "group -mx-1.5 px-1.5 py-0.5 transition hover:bg-white/[0.04]",
            )}
          >
            <span
              className={cn(
                "w-28 shrink-0 truncate text-right text-xs text-ink-muted",
                r.href && "group-hover:text-accent",
              )}
            >
              {r.name}
            </span>
            <div className="relative h-2.5 flex-1 rounded-full bg-white/[0.05]">
              <div
                className={cn(
                  "absolute h-full rounded-full bg-accent/70 transition-colors",
                  r.href && "group-hover:bg-accent",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
          </MaybeLink>
        );
      })}
      <div className="flex justify-between pl-[7.75rem] text-[0.6rem] text-ink-muted/60">
        <span>{from.slice(0, 4)}</span>
        <span>{to.slice(0, 4)}</span>
      </div>
    </div>
  );
}
