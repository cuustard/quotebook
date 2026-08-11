"use client";

/**
 * Stats for one quotebook.
 *
 * Everything is computed client-side from the same Dexie feed the quote list
 * uses, so this works offline and needs no extra queries. `computeStats` is a
 * single pass and memoized on the quote array, so switching filters or
 * re-rendering doesn't recompute it.
 *
 * Every mark is a deep link back into the feed with the matching filter
 * applied (see `lib/feedUrl.ts`) — click a month to read that month, a
 * speaker to read their quotes, a matrix cell to read the pair's shared ones.
 */

import Link from "next/link";
import { use, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { feedHref, monthBounds } from "@/lib/feedUrl";
import { getQuotesWithLines } from "@/lib/repo";
import { computeStats, pairKey, spanYears, WEEKDAY_LABELS } from "@/lib/stats";
import {
  BarList,
  ChartCard,
  ColumnChart,
  PairMatrix,
  SpanChart,
  StatTile,
} from "@/components/charts";

/** "18 Mar 2021" without pulling in a date library. */
function prettyDate(iso: string): string {
  const [y, m, d] = [iso.slice(0, 4), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

export default function QuotebookStatsPage({
  params,
}: {
  // Next 16: route params are always a Promise. In a Client Component they are
  // unwrapped with `use()`, which suspends until they resolve.
  params: Promise<{ id: string }>;
}) {
  const { id: bookId } = use(params);

  const book = useLiveQuery(
    async () => (await db.quotebooks.get(bookId)) ?? null,
    [bookId],
  );
  const quotesRaw = useLiveQuery(() => getQuotesWithLines(bookId), [bookId]);
  const quotes = useMemo(() => quotesRaw ?? [], [quotesRaw]);
  const stats = useMemo(() => computeStats(quotes), [quotes]);

  // Only the cast that actually shares quotes is worth a matrix.
  const matrixNames = useMemo(
    () => stats.bySpeaker.filter((s) => s.quotes > 1).slice(0, 8).map((s) => s.name),
    [stats],
  );
  const pairCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of stats.pairs) m.set(pairKey(p.a, p.b), p.count);
    return m;
  }, [stats]);

  if (book === undefined) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (book === null || book.deleted) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-heading text-xl text-ink">Quotebook not found</p>
        <Link href="/" className="qb-btn-primary mt-4 inline-flex">Back to dashboard</Link>
      </div>
    );
  }

  const hasData = stats.quotes > 0 && stats.first && stats.last;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-5">
        <Link href={`/quotebook/${bookId}`} className="text-xs text-ink-muted hover:text-ink">
          ← {book.name}
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-ink">Stats</h1>
        <p className="mt-1 text-xs text-ink-muted/70">
          Click anything to read those quotes.
        </p>
      </div>

      {!hasData ? (
        <div className="qb-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-heading text-lg text-ink">Nothing to measure yet</p>
          <p className="max-w-sm text-sm text-ink-muted">
            Add a few quotes and this page will fill up with timelines, who
            talks to whom, and what time of day you&apos;re all funniest.
          </p>
          <Link href={`/quotebook/${bookId}`} className="qb-btn-primary mt-1">
            Back to the feed
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Headline numbers. Only the ones with an unambiguous filter link. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile value={stats.quotes} label="quotes" href={feedHref(bookId, {})} />
            <StatTile value={stats.lines} label="lines" hint={`${stats.multiLine} conversations`} />
            <StatTile value={stats.speakerCount} label="quotees" />
            <StatTile
              value={`${spanYears(stats.first!, stats.last!)}y`}
              label="span"
              hint={`${prettyDate(stats.first!)} →`}
              href={feedHref(bookId, { since: stats.first!, before: stats.last! })}
            />
          </div>

          <ChartCard title="Quotes over time" subtitle="One bar per month — click to read that month">
            <ColumnChart
              data={stats.byMonth.map((b) => ({
                ...b,
                href: feedHref(bookId, monthBounds(b.key)),
              }))}
              height={130}
              labelEvery={Math.max(1, Math.ceil(stats.byMonth.length / 8))}
              formatTooltip={(d) => `${d.label}: ${d.count} quote${d.count === 1 ? "" : "s"}`}
            />
          </ChartCard>

          <div className="grid gap-4 sm:grid-cols-2">
            <ChartCard title="Time of day" subtitle="When it actually happened">
              <ColumnChart
                data={stats.byHour.map((count, h) => ({
                  key: String(h),
                  label: h % 6 === 0 ? `${h}` : "",
                  count,
                  href: feedHref(bookId, { hours: [h] }),
                }))}
                height={110}
                formatTooltip={(d) => `${d.label || ""}:00 — ${d.count}`}
              />
            </ChartCard>

            <ChartCard title="Day of the week">
              <ColumnChart
                data={stats.byWeekday.map((count, i) => ({
                  key: WEEKDAY_LABELS[i],
                  label: WEEKDAY_LABELS[i],
                  count,
                  href: feedHref(bookId, { weekdays: [i] }),
                }))}
                height={110}
              />
            </ChartCard>
          </div>

          <ChartCard title="Most quoted" subtitle="Quotes each person appears in">
            <BarList
              data={stats.bySpeaker.slice(0, 12).map((s) => ({
                key: s.name,
                label: s.name,
                count: s.quotes,
                sub: `${s.lines} line${s.lines === 1 ? "" : "s"}`,
                href: feedHref(bookId, { speakers: [s.name] }),
              }))}
            />
          </ChartCard>

          {matrixNames.length > 1 && (
            <ChartCard title="Who's in quotes together" subtitle="Shared quotes between each pair">
              <PairMatrix
                names={matrixNames}
                counts={pairCounts}
                // Both speakers must appear, so the pair filter is AND.
                hrefFor={(a, b) =>
                  feedHref(bookId, { speakers: [a, b], speakerMode: "and" })
                }
              />
            </ChartCard>
          )}

          {stats.spans.length > 1 && (
            <ChartCard title="Cast over time" subtitle="First to last appearance">
              <SpanChart
                rows={stats.spans.map((s) => ({
                  ...s,
                  href: feedHref(bookId, { speakers: [s.name] }),
                }))}
                from={stats.first!}
                to={stats.last!}
              />
            </ChartCard>
          )}

          {/* Odds and ends */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stats.busiestDay && (
              <StatTile
                value={stats.busiestDay.count}
                label="on the busiest day"
                hint={prettyDate(stats.busiestDay.date)}
                href={feedHref(bookId, {
                  since: stats.busiestDay.date,
                  before: stats.busiestDay.date,
                })}
              />
            )}
            <StatTile
              value={Math.round(stats.words / Math.max(1, stats.quotes))}
              label="words per quote"
              hint={`${stats.words.toLocaleString()} words total`}
            />
            {stats.longest && (
              <StatTile
                value={`${stats.longest.words}w`}
                label="longest quote"
                hint={stats.longest.preview}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
