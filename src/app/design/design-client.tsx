"use client";

import {
  Suspense,
  use,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  sendChatMessage,
  generateDesign,
  selectImage,
  deleteDesignImage,
  getDesignGallery,
  getDesignThread,
  getDesignJobs,
  cancelGeneration,
  uploadReferenceImage,
  closeConversation,
  reopenConversation,
  startConversationFromImage,
} from "./actions";
import { Button } from "@/components/ui";
import { PublishModal } from "@/components/publish-modal";
import type { ChatMessage } from "@/lib/db/schema";
import type { ChatOption } from "@/lib/ai";
import type { DesignImage, ProductVersionGroup } from "@/lib/design-images";
import type { DesignThreadData } from "@/lib/design-thread";
import { ChatPanel } from "./chat-panel";
import { DesignStage } from "./design-stage";
import { ImageLightbox } from "./image-lightbox";
import { MobileGalleryDrawer } from "./mobile-gallery-drawer";
import { MobileGalleryStrip } from "./mobile-gallery-strip";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { isDesignEmpty, sourcesToGalleryImages } from "@/lib/design-view";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import {
  readThreadSnapshot,
  writeThreadSnapshot,
  dropThreadSnapshot,
  canWriteThreadSnapshot,
  threadToSnapshot,
} from "@/lib/design-thread-cache";
import {
  nextPollDelayMs,
  shouldPoll,
  isAtGenerationCap,
  reduceJobPoll,
  isPollHalted,
  type RunningJob,
} from "@/lib/generation-poll";

/**
 * Job state for this thread.
 *
 * `tracked` outlives `running` on purpose: a job settles by dropping out of
 * the running list, and its outcome — the image, the assistant turn, an
 * error — is only readable on the poll that notices. Untracking happens after
 * that outcome has been applied, which is also what keeps the poll loop alive
 * for one more tick.
 */
type JobState = { running: RunningJob[]; tracked: string[] };

/**
 * A failed poll is a non-event: the next tick retries, and the job rows are
 * the truth either way. Swallowing here keeps a transient network blip from
 * showing the user a generation error that never happened.
 */
async function readJobs(designId: string, tracked: string[]) {
  try {
    return await getDesignJobs(designId, tracked);
  } catch {
    return null;
  }
}

interface Props {
  /**
   * Server-fetched thread for ?id= visits (null for new threads, guests, and
   * foreign/missing designs). Left un-awaited by the server component so the
   * shell streams immediately; resolved here.
   */
  initialThreadPromise: Promise<DesignThreadData | null>;
}

export function DesignPageClient(props: Props) {
  return (
    <Suspense>
      <DesignPageInner {...props} />
    </Suspense>
  );
}

function DesignPageInner({ initialThreadPromise }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Frozen at mount: this page never switches threads in place (fresh-start
  // does a full navigation), and a popstate re-render mid back-navigation
  // briefly reports the next URL's (empty) query — a live read there would
  // change the conditional use() below between renders (React #310).
  const [resumeId] = useState(() => searchParams.get("id"));
  const designId = useRef(resumeId ?? crypto.randomUUID());

  // Initial thread state, in precedence order:
  // 1. Client thread cache — a snapshot warmed from a /designs card (#87) or
  //    written back by a previous visit to this thread (revisit path, #127).
  //    Read once (lazy initializer) so a later warm can't retro-populate a
  //    live session; the server payload below still revalidates it.
  // 2. The server-streamed thread — chat AND gallery in one payload, so a
  //    thread with images can never hydrate into the gallery's "no images
  //    yet" state. use() suspends first render until the payload resolves;
  //    conditional on a cache miss, frozen so the call pattern is stable for
  //    this component instance.
  const [cached] = useState(() =>
    resumeId ? readThreadSnapshot(resumeId) : undefined
  );
  const [useServerThread] = useState(
    () => cached === undefined && resumeId !== null
  );
  const serverThread = useServerThread ? use(initialThreadPromise) : null;
  const initial = cached ?? (serverThread ? threadToSnapshot(serverThread) : undefined);

  const [messages, setMessages] = useState<ChatMessage[]>(initial?.chat ?? []);
  const [images, setImages] = useState<DesignImage[]>(initial?.images ?? []);
  const [productGroups, setProductGroups] = useState<ProductVersionGroup[]>(
    initial?.productGroups ?? []
  );
  const [selectedImage, setSelectedImage] = useState<string | null>(
    initial?.displayImageUrl ?? null
  );
  const [loading, setLoading] = useState(false);
  // Closed conversation (slice 3): read-only thread. Loaded with the design
  // row; the server actions are the backstop, this drives the UI swap.
  const [closed, setClosed] = useState(initial?.closed ?? false);
  // Close/Reopen only renders once the design row exists server-side.
  const [designExists, setDesignExists] = useState(initial !== undefined);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [publishImageId, setPublishImageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Soft nudge: Generate/Compare dim until Claude judges the idea concrete
  // (subject + style). A design with existing renders starts ready.
  const [readyToGenerate, setReadyToGenerate] = useState(
    (initial?.images.length ?? 0) > 0
  );
  // Tappable quick-replies attached to the most recent assistant turn. Cleared
  // at the start of every new turn so chips never outlive the question.
  const [options, setOptions] = useState<ChatOption[]>([]);
  // Durable generation: the job rows are the state, so several can run at
  // once and they survive this tab. Seeded empty even on a resume — the first
  // poll (fired on mount below) reports anything already running, including
  // jobs started in another tab or before a reload.
  const [jobs, setJobs] = useState<JobState>({ running: [], tracked: [] });
  // `generateDesign` calls that have not returned yet: no job row exists for
  // them, so the cap check has to count them separately or a triple-tap
  // outruns the server.
  const [pending, setPending] = useState(0);
  // Bumped after every poll to re-arm the timer effect (see below).
  const [pollNonce, setPollNonce] = useState(0);
  // Failed polls in a row. Past the budget the loop goes dormant rather than
  // retrying forever — an abandoned tab whose design was deleted underneath it
  // would otherwise issue a request every five seconds indefinitely, which on
  // a phone is pure battery and data drain. A wake event resets it.
  const [pollErrors, setPollErrors] = useState(0);
  // Last failed generation, shown inline. Cleared when a new one starts.
  const [genError, setGenError] = useState<string | null>(null);

  const running = jobs.running;
  const generating = running.length > 0 || pending > 0;
  const atCapacity = isAtGenerationCap(running.length, pending);

  const refreshGallery = useCallback(async () => {
    const { sources, productGroups } = await getDesignGallery(designId.current);
    setReadyToGenerate(sources.length > 0);
    setImages(sourcesToGalleryImages(sources));
    setProductGroups(productGroups);
  }, []);

  // A chat turn in flight owns the message list: `sendChatMessage` persists
  // both its rows only when it returns, so a whole-thread read taken meanwhile
  // would render the user's own words back out of the thread. Read from a ref
  // so the poll loop doesn't have to re-subscribe on every keystroke-adjacent
  // state change.
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const pollErrorsRef = useRef(0);
  pollErrorsRef.current = pollErrors;

  /**
   * Re-read chat AND gallery together. The assistant turn for a generation is
   * written by the background continuation, so refreshing only the gallery
   * leaves the thread one turn short until a reload — the most visible defect
   * this path can have.
   */
  const refreshThread = useCallback(async (): Promise<boolean> => {
    const thread = await getDesignThread(designId.current).catch(() => null);
    if (!thread) return false;
    const snap = threadToSnapshot(thread);
    setMessages(snap.chat);
    setImages(snap.images);
    setProductGroups(snap.productGroups);
    setClosed(snap.closed);
    setReadyToGenerate(snap.images.length > 0);
    // The hero follows the server's primary image, which the continuation
    // claims for a fresh generation (and deliberately does not claim for a
    // cancelled one).
    setSelectedImage(snap.displayImageUrl);
    return true;
  }, []);

  // One poll in flight at a time: the timer and a wake event can fire together.
  const polling = useRef(false);
  const pollStartedAt = useRef<number | null>(null);

  // Mirrors `jobs.tracked` for the poll loop, which must not re-subscribe on
  // every job change or it would restart its own timer mid-wait.
  const trackedRef = useRef<string[]>([]);
  trackedRef.current = jobs.tracked;

  const pollOnce = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const tracked = trackedRef.current;
      // null on a failed request — the reducer turns that into an error-budget
      // step rather than the caller branching on it here.
      const result = await readJobs(designId.current, tracked);

      // All the branching is in a pure reducer (generation-poll.ts) so the
      // deferral, refresh and error-budget decisions are testable without a
      // component.
      const step = reduceJobPoll({
        trackedJobIds: tracked,
        result,
        chatTurnInFlight: loadingRef.current,
        consecutiveErrors: pollErrorsRef.current,
      });
      setPollErrors(step.consecutiveErrors);
      pollErrorsRef.current = step.consecutiveErrors;

      // A failed poll leaves the running list alone: blanking it would flicker
      // the spinner rows off a generation that is still going.
      if (step.running === null) return;

      // `tracked` is NOT narrowed here: the settled ids stay tracked for the
      // whole settle, which is what holds `active` true and keeps the
      // revisit-cache write-back gated while the thread is mid-change.
      // Untracking below is the last thing that happens.
      setJobs({ running: step.running, tracked });

      if (step.errorCopy) setGenError(step.errorCopy);
      if (step.settling.length === 0) return;

      if (step.refreshThread) {
        const refreshed = await refreshThread();
        // A failed read leaves the ids tracked, so the next tick retries —
        // and, critically, leaves the cached snapshot alone. Dropping it here
        // and failing to replace it would strand the thread on a cache miss;
        // untracking here would let the write-back effect fire with the
        // pre-refresh state and re-plant the very "no image yet" snapshot the
        // drop exists to remove.
        if (!refreshed) return;
        // Ordered after the refresh on purpose: by now the fresh thread is in
        // state, so the write-back that follows untracking writes the settled
        // thread rather than the stale one.
        dropThreadSnapshot(designId.current);
      }

      setJobs((prev) => ({
        running: prev.running,
        tracked: prev.tracked.filter((id) => !step.settling.includes(id)),
      }));
    } finally {
      polling.current = false;
      setPollNonce((n) => n + 1);
    }
  }, [refreshThread]);

  // Poll only while something is running or a settled outcome is still
  // unapplied; stop entirely otherwise. The schedule lives in generation-poll
  // so the arithmetic is testable without a component.
  // Halted is a stop, not a give-up: the wake handler below clears the budget,
  // so the loop resumes the moment the user looks at the tab again.
  const active =
    shouldPoll(running.length, jobs.tracked.length) && !isPollHalted(pollErrors);
  useEffect(() => {
    if (!active) {
      pollStartedAt.current = null;
      return;
    }
    if (pollStartedAt.current === null) pollStartedAt.current = Date.now();
    const delay = nextPollDelayMs(Date.now() - pollStartedAt.current);
    const timer = setTimeout(() => void pollOnce(), delay);
    return () => clearTimeout(timer);
  }, [active, pollNonce, pollOnce]);

  // Phone-first: app-switching is the main journey, and this is the only
  // mechanism that makes leave-and-return work — a backgrounded tab's timers
  // are throttled or frozen, so the wake itself has to fetch rather than wait
  // for a tick that may never have run.
  //
  // Armed for any real thread, not only while this tab believes something is
  // running: the job that settled (or was started in another tab) is exactly
  // what a return is for. A brand-new, unsaved thread has nothing to ask
  // about, so it stays off there.
  const designExistsRef = useRef(false);
  designExistsRef.current = designExists;
  useEffect(() => {
    function onWake() {
      if (document.visibilityState !== "visible") return;
      if (!designExistsRef.current) return;
      // Coming back is the resume path for a dormant loop: clear the budget
      // first (both the ref this poll reads and the state the timer effect
      // gates on) so one wake both retries now and re-arms the loop.
      pollErrorsRef.current = 0;
      setPollErrors(0);
      void pollOnce();
    }
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [pollOnce]);

  // First read on an existing thread: adopt jobs this client never started —
  // another tab, or this one before a reload.
  useEffect(() => {
    if (!resumeId) return;
    void pollOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guest funnel (#26): mint an anonymous session on entry so a signed-out
  // visitor can design without hitting the auth wall. No-op when already
  // signed in; the gate now lives at checkout.
  useEffect(() => {
    ensureGuestSession();
  }, []);

  // Landing seed: /design?prompt=… fires one generation with the seeded idea
  // (new designs only — never when resuming via ?id=). Ref-guarded so React
  // Strict Mode's double effect can't fire it twice; the param is stripped
  // immediately so refresh/back doesn't resubmit — via history.replaceState
  // (shallow, no router re-render) because a router.replace issued right
  // before a server-action call gets cancelled by the action. A thin seed is
  // caught by the fast readiness check inside generateDesign and answered
  // with a clarifying question instead of a render — no new guard needed.
  const seedFired = useRef(false);
  useEffect(() => {
    const prompt = searchParams.get("prompt");
    if (!prompt || searchParams.get("id") || seedFired.current) return;
    seedFired.current = true;
    window.history.replaceState(null, "", "/design");
    handleGenerate(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache-hydrated mounts still revalidate: the server payload resolves with
  // fresh data and replaces the snapshot — unless the user has already acted,
  // so it can never clobber optimistic state.
  //
  // `userActed` is a plain boolean, not a turn token: the old tracker minted
  // an id here and then only ever asked "is this still the latest turn", which
  // for a one-shot mount effect means exactly "has any turn started since".
  const userActed = useRef(false);
  const revalidated = useRef(false);
  useEffect(() => {
    if (!resumeId || cached === undefined || revalidated.current) return;
    revalidated.current = true;
    // await, not .then-chaining: the streamed prop is a React-deserialized
    // thenable whose .then() doesn't return a chainable promise.
    (async () => {
      const thread = await initialThreadPromise;
      if (!thread || userActed.current) return;
      const snap = threadToSnapshot(thread);
      setMessages(snap.chat);
      setImages(snap.images);
      setProductGroups(snap.productGroups);
      setSelectedImage(snap.displayImageUrl);
      setClosed(snap.closed);
      setDesignExists(true);
      setReadyToGenerate(snap.images.length > 0);
    })().catch(() => {});
  }, [resumeId, cached, initialThreadPromise]);

  // Revisit cache write-back (#127): mirror the rendered thread so /designs →
  // thread → back → same thread re-renders instantly.
  //
  // Never while a job is running for this design: the thread is mid-change,
  // and the snapshot taken then is precisely the "no image yet" state the
  // returning user must not see. The settle path drops the entry outright, so
  // the first write after that is of the settled thread.
  useEffect(() => {
    // Narrowed here as well as inside the gate so `resumeId` types as the
    // cache key below; the gate stays the single statement of the rule.
    if (!resumeId) return;
    if (
      !canWriteThreadSnapshot({
        resumeId,
        designExists,
        jobsActive: active,
        generating,
      })
    ) {
      return;
    }
    writeThreadSnapshot(resumeId, {
      chat: messages,
      images,
      productGroups,
      displayImageUrl: selectedImage,
      closed,
    });
  }, [
    resumeId,
    designExists,
    active,
    generating,
    messages,
    images,
    productGroups,
    selectedImage,
    closed,
  ]);

  function makeOptimisticMessage(
    role: "user" | "assistant",
    content: string,
    imageId: string | null = null
  ): ChatMessage {
    return {
      id: `optimistic-${crypto.randomUUID()}`,
      designId: designId.current,
      role,
      content,
      imageId,
      createdAt: new Date(),
    };
  }

  async function handleSend(userMessage: string) {
    userActed.current = true;
    setLoading(true);
    setOptions([]);
    setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);

    try {
      await ensureGuestSession();
      const result = await sendChatMessage(designId.current, userMessage);
      setDesignExists(true);
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", result.message),
      ]);
      // No staleness guard: the composer blocks a second chat turn while this
      // one is in flight, and Generate is disabled while `loading`, so nothing
      // else can own options/readiness by the time this resolves.
      setReadyToGenerate(result.readyToGenerate);
      setOptions(result.options);
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Something went wrong. Try again."),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(userMessage?: string) {
    // Three concurrent generations are the point of the durable job; the only
    // refusal is the cap itself, enforced for real by insertGenerationJob's
    // INSERT…WHERE. This check just avoids a round trip that would be refused.
    if (atCapacity || closed) return;
    userActed.current = true;
    setPending((n) => n + 1);
    setGenError(null);
    setOptions([]);
    if (userMessage) {
      setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);
    }

    try {
      await ensureGuestSession();
      const result = await generateDesign(designId.current, userMessage);
      setDesignExists(true);

      if (result.kind === "queued") {
        // The render finishes in the background; this action returned as soon
        // as the job row existed. Adopt the job locally right away rather than
        // waiting for the first poll to report it — otherwise the generating
        // row blinks out for a poll interval.
        setJobs((prev) => ({
          running: [
            ...prev.running,
            { jobId: result.jobId, generationNumber: result.generationNumber },
          ],
          tracked: [...prev.tracked, result.jobId],
        }));
        return;
      }

      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", result.message),
      ]);
      // No staleness guard: cancellation now targets a job row, which only
      // exists on the queued path, so nothing can cancel this turn. Two
      // concurrent generates that both come back as clarifications resolve in
      // start order, which is the same last-writer the tracker would have
      // picked.
      if (result.kind === "clarification") {
        setReadyToGenerate(false);
        // A clarifying question may carry tappable style options.
        setOptions(result.options ?? []);
      } else {
        // Cap or capacity refusal — the idea itself is still renderable.
        setReadyToGenerate(true);
      }
    } catch {
      // Every throw here happens before a job row exists (the action returns
      // the moment one does), so there is no cancelled turn to stay quiet for
      // — a throw is always a real failure worth surfacing.
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Generation failed. Try again."),
      ]);
    } finally {
      setPending((n) => n - 1);
    }
  }

  /**
   * Cancel one running generation (#59, now durable). The server marks the job
   * row cancelled, so this holds across tabs and reloads where the old
   * client-side ref did not. The render itself still runs and is still billed;
   * cancelling only forfeits its claim on the design's primary image.
   *
   * Untracked locally either way, which also stops polling for it — the user
   * walked away from this one.
   */
  async function handleCancelJob(jobId: string) {
    setJobs((prev) => ({
      running: prev.running.filter((job) => job.jobId !== jobId),
      tracked: prev.tracked.filter((id) => id !== jobId),
    }));
    try {
      await cancelGeneration(jobId);
    } catch {
      // Nothing to recover: the row either settled first or was never ours.
    }
  }

  async function handleDeleteImage(imageId: string) {
    const deleted = images.find((img) => img.id === imageId);
    try {
      await deleteDesignImage(designId.current, imageId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      window.alert(msg);
      return;
    }
    await refreshGallery();
    // If lightbox was open on this image, clamp or close
    setImages((current) => {
      if (current.length === 0) {
        setLightboxIndex(null);
      } else if (lightboxIndex !== null) {
        setLightboxIndex(Math.min(lightboxIndex, current.length - 1));
      }
      return current;
    });
    if (deleted && selectedImage === deleted.url) {
      setSelectedImage(null);
    }
  }

  // Publishing opens the modal (name/description/backdrop). Close the
  // lightbox first so the modal isn't stacked on top of it; the modal does
  // the publish and routes to the new public page.
  function handlePublishImage(imageId: string) {
    setLightboxIndex(null);
    setPublishImageId(imageId);
  }

  async function handleUploadImage(base64: string, fileName: string) {
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      makeOptimisticMessage("user", `Uploaded reference image: ${fileName}`),
    ]);

    try {
      await ensureGuestSession();
      const result = await uploadReferenceImage(
        designId.current,
        base64,
        fileName
      );
      // Update the last user message with the image id and refresh
      // gallery so the new design_image row is visible.
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "user") {
          updated[lastIdx] = { ...updated[lastIdx], imageId: result.imageId };
        }
        return updated;
      });
      await refreshGallery();
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Upload failed. Try again."),
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Close/Reopen (slice 3). Optimistic-free: await the action, then flip the
  // UI — the two states differ too much for a rollback to read cleanly.
  async function handleToggleClosed() {
    try {
      if (closed) {
        await reopenConversation(designId.current);
        setClosed(false);
      } else {
        await closeConversation(designId.current);
        setClosed(true);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
    }
  }

  // Fresh start (slice 3): new conversation seeded by this image. Full
  // navigation, not router.push — designId lives in a ref, so an in-place
  // /design?id= change would keep operating on the old thread.
  async function handleStartFromImage(imageId: string) {
    try {
      const { designId: newId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${newId}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
    }
  }

  // Stage thumbnail tap (#147): promote the image to the design's primary and
  // lead with it. Same semantics as the lightbox's "make products for this
  // image" minus the navigation — so the hero, /preview, and the My Designs
  // card thumbnail never disagree about which image the design is.
  async function handleSelectImage(imageUrl: string) {
    setSelectedImage(imageUrl);
    try {
      await selectImage(designId.current, imageUrl);
    } catch {
      // Non-fatal: the hero still shows the tapped image for this visit.
    }
  }

  function handleMakeProducts() {
    if (!selectedImage) return;
    router.push(`/preview?id=${designId.current}`);
  }

  async function handleMakeProductsForImage(imageUrl: string) {
    // selectImage promotes this image to primary_image_id first, so
    // /preview anchors on the user's pick rather than the latest.
    await selectImage(designId.current, imageUrl);
    setSelectedImage(imageUrl);
    router.push(`/preview?id=${designId.current}`);
  }

  async function handleSelectProductVersion(productId: string) {
    router.push(`/preview?id=${designId.current}&product=${productId}`);
  }

  const empty = isDesignEmpty(messages.length, images.length);

  return (
    <div className="h-[calc(100vh-41px)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        {/* The breadcrumb already names the page; a repeated <h1> under it was
            two stacked "Design" titles (#147). */}
        <Breadcrumbs
          trail={breadcrumbTrail("/design", { id: designId.current })}
          current="Design"
        />
        {designExists && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleClosed}
            data-testid="toggle-closed"
          >
            {closed ? "Reopen" : "Close"}
          </Button>
        )}
      </div>

      {/* Body — centered composer when empty, otherwise: desktop leads with
          the artwork (DesignStage) and chat is the column beside it (#147);
          mobile stays chat-first with the strip + drawer. */}
      <div className="flex-1 flex overflow-hidden">
        {!empty && (
          <DesignStage
            images={images}
            productGroups={productGroups}
            selectedImage={selectedImage}
            generating={generating}
            onSelectImage={handleSelectImage}
            onOpenLightbox={(i) => setLightboxIndex(i)}
            onMakeProducts={handleMakeProducts}
            onSelectProductVersion={handleSelectProductVersion}
          />
        )}
        <ChatPanel
          className={
            empty
              ? undefined
              : "flex-1 md:flex-none md:w-[420px] md:border-l md:border-border flex flex-col min-w-0 relative"
          }
          messages={messages}
          images={images}
          loading={loading}
          generating={generating}
          runningJobs={running}
          atCapacity={atCapacity}
          generationError={genError}
          onDismissGenerationError={() => setGenError(null)}
          onSend={handleSend}
          onGenerate={handleGenerate}
          onCancelJob={handleCancelJob}
          readyToGenerate={readyToGenerate}
          options={options}
          onUploadImage={handleUploadImage}
          isEmpty={empty}
          closed={closed}
          onReopen={handleToggleClosed}
          mobileGalleryStrip={
            <MobileGalleryStrip
              images={images}
              productGroups={productGroups}
              selectedImage={selectedImage}
              generating={generating}
              onClickImage={(i) => setLightboxIndex(i)}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
          }
        />
      </div>

      {/* Mobile gallery drawer */}
      <MobileGalleryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        images={images}
        productGroups={productGroups}
        selectedImage={selectedImage}
        generating={generating}
        onClickImage={(i) => {
          setDrawerOpen(false);
          setLightboxIndex(i);
        }}
        onMakeProducts={handleMakeProducts}
        onSelectProductVersion={(productId) => {
          setDrawerOpen(false);
          handleSelectProductVersion(productId);
        }}
      />

      {/* Lightbox */}
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onDelete={handleDeleteImage}
          onMakeProducts={handleMakeProductsForImage}
          onPublish={handlePublishImage}
          onStartFrom={handleStartFromImage}
        />
      )}

      <PublishModal
        imageId={publishImageId}
        imageUrl={
          publishImageId
            ? (images.find((img) => img.id === publishImageId)?.url ?? null)
            : null
        }
        open={publishImageId !== null}
        onClose={() => setPublishImageId(null)}
      />
    </div>
  );
}
