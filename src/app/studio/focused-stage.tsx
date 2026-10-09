"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { StudioLane } from "@/lib/studio";
import { buyPageHref } from "@/lib/buy-page-picks";
import { DEFAULT_BLANK_ID, getColorHex, publishedBackdrop } from "@/lib/blanks";
import { formatElapsed } from "@/lib/studio-view";
import { historyTurnLabel } from "@/lib/studio-focus";
import { getConversationHistory, type HistoryTurn } from "./actions";

const MONO = "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";
const HISTORY_FAILED_COPY = "Couldn't load the history.";

/**
 * The focused stage (#188 slice 4, board C/F/G of the 2026-10-08 canvas):
 * one result large on its backdrop, the composer under it, the
 * conversation's other results as a strip, the transcript behind a
 * collapsed disclosure. Presentational: StudioClient owns focus, submit,
 * poll and cancel, and passes its own <Composer/> in through `composer`.
 * Every in-stage link is a real <a href> (new-tab works); StudioClient's
 * handlers preventDefault and pushState so the lanes in client state are
 * reused instead of re-fetched.
 */
export function FocusedStage({
  lane,
  index,
  nowMs,
  composer,
  unresolvedCellIds,
  onBack,
  onPickResult,
  onNewDesign,
  onCancel,
  focusHrefFor,
  benchHref,
}: {
  lane: StudioLane;
  index: number;
  nowMs: number;
  composer: ReactNode;
  unresolvedCellIds: Set<string>;
  onBack: (e: MouseEvent<HTMLAnchorElement>) => void;
  onPickResult: (index: number, e: MouseEvent<HTMLAnchorElement>) => void;
  onNewDesign: (e: MouseEvent<HTMLAnchorElement>) => void;
  onCancel: (jobId: string) => void;
  focusHrefFor: (index: number) => string;
  benchHref: string;
}) {
  const cell = lane.cells[index];
  const published = cell.backdropColor !== null;
  // Published: the pinned Shop backdrop (#302 rule for admin grids). Not
  // published: the paper well; the #139 slice decides its tone later.
  const frame = published
    ? publishedBackdrop(cell.backdropColor)
    : { className: "bg-surface-well", style: undefined };

  return (
    <div data-testid="focused-stage" className="lg:grid lg:grid-cols-[600px_1fr] lg:gap-12">
      <div className={`h-11 flex items-center justify-between ${MONO} lg:col-span-2`}>
        <a href={benchHref} onClick={onBack} className="text-text-muted no-underline hover:text-foreground min-h-11 inline-flex items-center">
          ← Studio
        </a>
        <span>Result {index + 1} of {lane.cells.length}</span>
      </div>

      <div>
        <div
          data-testid="stage-frame"
          className={`relative w-full max-w-[600px] aspect-square border border-border p-6 ${frame.className}`}
          style={frame.style}
        >
          <Image
            data-testid="stage-image"
            src={cell.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            className="object-contain p-6"
            priority
          />
        </div>
        {published && (
          <div className={`mt-1.5 flex items-center gap-2 ${MONO}`}>
            <span
              className="inline-block w-3 h-3 border border-border"
              style={{ backgroundColor: getColorHex(DEFAULT_BLANK_ID, cell.backdropColor) }}
            />
            <span>Shown on {cell.backdropColor}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 mt-2 lg:mt-0">
        {composer}

        <div className="h-11 flex items-center gap-5 text-sm">
          <Link href={buyPageHref(cell.imageId, { order: true, from: "/studio" })} className="underline underline-offset-[3px]">
            Order
          </Link>
          <Link href={`/d/${cell.imageId}`} className="underline underline-offset-[3px]">
            Open
          </Link>
          <a href={benchHref} onClick={onNewDesign} className="underline underline-offset-[3px]">
            New design
          </a>
        </div>

        <div className="flex flex-col gap-2">
          <span className={MONO}>Other results</span>
          <div data-testid="stage-results" className="flex gap-2 overflow-x-auto pb-1">
            {lane.cells.map((c, i) => {
              const shown = i === index;
              return (
                <a
                  key={c.imageId}
                  href={focusHrefFor(i)}
                  onClick={(e) => onPickResult(i, e)}
                  aria-label={`Result ${i + 1}${shown ? ", shown" : ""}`}
                  aria-current={shown ? "true" : undefined}
                  className={`relative shrink-0 w-14 h-14 lg:w-22 lg:h-22 bg-surface-well ${
                    shown ? "border-2 border-foreground" : "border border-border"
                  }`}
                >
                  <Image src={c.imageUrl} alt="" fill sizes="88px" className="object-contain" />
                </a>
              );
            })}
            {lane.pending.map((job) => (
              <div
                key={job.jobId}
                data-testid="stage-pending-cell"
                className="shrink-0 w-14 h-14 lg:w-22 lg:h-22 border border-dashed border-foreground bg-surface flex items-center justify-center"
              >
                <span className={`${MONO} animate-pulse`}>…</span>
              </div>
            ))}
          </div>
          {lane.pending.map((job) => {
            // Same contract as the bench's pending cell: Cancel is inert and
            // invisible until generateDesign has returned a real job id.
            const unresolved = unresolvedCellIds.has(job.jobId);
            return (
              <div key={job.jobId} className={`h-11 flex items-center gap-2 ${MONO}`}>
                <span className="animate-pulse">Generating…</span>
                <span className="tabular-nums text-text-faint">{formatElapsed(nowMs - job.startedAt.getTime())}</span>
                <span>·</span>
                <button
                  type="button"
                  disabled={unresolved}
                  aria-hidden={unresolved || undefined}
                  tabIndex={unresolved ? -1 : undefined}
                  onClick={unresolved ? undefined : () => onCancel(job.jobId)}
                  className={`min-h-11 px-2 text-foreground underline underline-offset-[3px] normal-case tracking-normal text-xs ${unresolved ? "invisible" : ""}`}
                  data-testid={unresolved ? "cancel-generation-placeholder" : "cancel-generation"}
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>

        <History lane={lane} />
      </div>
    </div>
  );
}

function History({ lane }: { lane: StudioLane }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<HistoryTurn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const label = `History · ${lane.messageCount} ${lane.messageCount === 1 ? "message" : "messages"}`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || turns !== null) return;
    try {
      setTurns(await getConversationHistory(lane.designId));
    } catch (err) {
      console.error("History load failed:", err instanceof Error ? err.message : String(err));
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => void toggle()}
        className={`w-full min-h-11 border-t border-border flex items-center justify-between ${MONO}`}
      >
        <span>{label}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col text-sm leading-5">
          {failed && <p className="py-2.5 text-text-muted">{HISTORY_FAILED_COPY}</p>}
          {turns?.map((t) => (
            <div key={t.id} className="py-2.5 border-t border-border flex flex-col gap-1">
              <span className={`${MONO} text-text-faint`}>{historyTurnLabel(t, lane.cells)}</span>
              <p className={`m-0 whitespace-pre-wrap ${t.role === "assistant" ? "text-text-muted" : ""}`}>{t.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
