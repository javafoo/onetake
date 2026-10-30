"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import { askOptions, DEFAULT_CHOICE, MAX_ATTACHED_PHOTOS, modelChipLabel, oneLineHook, rememberedChoice, withPinnedHook, type ComposerChoice } from "@/agent/composer";
import { MAX_ATTACHMENTS, MAX_MESSAGE_CHARS } from "@/agent/plan";
import { textChipLabel } from "@/content/text-styles";
import type { AgentView } from "@/agent/view";
import { setSetFavoriteAction } from "@/app/carousels/actions";
import { setFavoriteAction } from "@/app/library/actions";
import { acceptOfferAction, declineOfferAction, openThreadAction, startThreadAction, type ThreadDetail, type ThreadSummary } from "@/app/create/v2-actions";
import { JobStatus } from "@/components/job-status";
import { Badge, Button, buttonClass, Card, creditWord, DownloadCorner, MediaTile } from "@/components/ui";
import { ArrowIcon, ChevronIcon, ImageIcon, PlusIcon, SparkIcon, UploadIcon } from "@/components/ui/icons";
import { ResultMessage } from "@/components/ui/message";
import { downloadHref } from "@/lib/download";

import { readChoice, subscribeChoice, writeChoice } from "./choice-memory";
import { LibraryPicker, type PickedHook, type PickedItem } from "./library-picker";
import { ModelPanel } from "./model-panel";
import { OfferCard } from "./offer-card";
import { isImageFile, shrink, type Attachment } from "./screenshots";
import { TextStylePicker } from "./text-style-picker";
import { ThreadList } from "./thread-list";
import { FactLine, ToolLines } from "./tool-line";
import { readTurnStream } from "./turn-stream";
import { agentJobStatus, applyEvent, jobPollUrl, settleOffer, threadCards, threadTitle, waitingForWords, withHerMessage, type JobRef, type ThreadCard, type TurnPart } from "./thread-view";

/* The Create chat, version 2. Her message goes to the turn route, which
   streams the agent's reply back as events: words, the tools it used, offers
   for anything that costs credits, jobs it started, facts it remembered. The
   cards are worked out from those events by `thread-view.ts`, the same way
   a stored thread is, so a reload shows what the stream showed.

   Nothing paid starts from here except an offer's button, which names the
   price, and the server starts it once however often it is tapped. A job
   card asks where its kind is moved along (`jobPollUrl`): an agent run
   through /api/agent/[id].

   The box keeps the first chat's pickers: the model panel (Image, Video or
   Slides, with a model, a shape, a format and a layout) and the text look.
   What she picked goes with every message as options and is applied to
   whatever the agent makes. Library items attached with + are material;
   screenshots pasted, dropped or uploaded are reference, read once and never
   kept. */

/** Where turns go. */
export const TURN_URL = "/api/agent/v2/turn";

type Props = {
  /** The last ten chats for this avatar, newest first. */
  threads: ThreadSummary[];
  /** The chat to open on, if any: usually the newest. */
  thread?: ThreadDetail | null;
};

/** Library items on the message: ids go to the server, the rest draws the thumbnails. */
type Material = { photos: PickedItem[]; clip: PickedItem | null };
const NO_MATERIAL: Material = { photos: [], clip: null };

type Problem = { message: string; fix?: { label: string; href: string } };

const CHIP = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";
const STREAM_BROKE = "The reply stopped part way. Send your message again.";

export function ChatV2({ threads: initialThreads, thread = null }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(thread?.id ?? null);
  const [cards, setCards] = useState<ThreadCard[]>(() => threadCards(thread?.messages ?? []));
  const [message, setMessage] = useState("");
  const [pinned, setPinned] = useState<PickedHook | null>(null);
  const [material, setMaterial] = useState<Material>(NO_MATERIAL);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "library" | "threads" | "model" | "text">(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /* Her last models, shape, text look and format come back on the next
     visit, read as an external store so the server's page and the browser's
     first paint agree. What she picks here wins, and is written down as she
     picks it. */
  const stored = useSyncExternalStore(subscribeChoice, readChoice, () => null);
  const [picked, setPicked] = useState<ComposerChoice | null>(null);
  const choice = picked ?? rememberedChoice(stored, DEFAULT_CHOICE);
  const setChoice = (next: ComposerChoice | ((current: ComposerChoice) => ComposerChoice)) => {
    const value = typeof next === "function" ? next(choice) : next;
    setPicked(value);
    writeChoice(value);
  };
  const [plusOpen, setPlusOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const [switching, startSwitch] = useTransition();
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const [boxHeight, setBoxHeight] = useState(0);

  useEffect(() => {
    const form = box.current;
    if (!form) return;
    const observer = new ResizeObserver(() => setBoxHeight(form.offsetHeight + 16));
    observer.observe(form);
    return () => observer.disconnect();
  }, [folded]);

  // A reply still streaming when she leaves the page is let go of.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [cards]);

  const hasMaterial = material.photos.length > 0 || material.clip !== null;
  const busy = streaming || switching;
  const canSend = !busy && (message.trim().length > 0 || pinned !== null || hasMaterial || attachments.length > 0);
  const attachedIds = { photos: material.photos.map((photo) => photo.id), clip: material.clip?.id ?? null };

  const addFiles = async (files: FileList | File[]) => {
    const images = Array.from(files).filter(isImageFile);
    if (images.length === 0) return;
    setProblem(null);
    try {
      const shrunk = await Promise.all(images.map(shrink));
      setAttachments((current) => [...current, ...shrunk].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      setProblem({ message: error instanceof Error ? error.message : "That image could not be read." });
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(isImageFile);
    if (files.length === 0) return; // plain text pastes as usual
    event.preventDefault();
    void addFiles(files);
  };
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };
  const current = threads.find((item) => item.id === threadId);

  const addMaterial = (item: PickedItem) => {
    setProblem(null);
    if (item.kind === "clip") {
      setMaterial((was) => ({ ...was, clip: item }));
      return;
    }
    if (material.photos.length >= MAX_ATTACHED_PHOTOS && !material.photos.some((photo) => photo.id === item.id)) {
      setProblem({ message: `Up to ${MAX_ATTACHED_PHOTOS} photos per message. Take one off first.` });
      return;
    }
    setMaterial((was) => (was.photos.some((photo) => photo.id === item.id) ? was : { ...was, photos: [...was.photos, item] }));
  };
  const removeMaterial = (id: string) => setMaterial((was) => ({ photos: was.photos.filter((photo) => photo.id !== id), clip: was.clip?.id === id ? null : was.clip }));

  /** The drawer's list with this chat first, so a new chat shows up the moment it has a title. */
  const touchThread = (id: string, firstMessage: string) =>
    setThreads((list) => {
      const found = list.find((item) => item.id === id);
      const touched: ThreadSummary = { id, title: found?.title ?? threadTitle(firstMessage), updatedAt: new Date().toISOString() };
      return [touched, ...list.filter((item) => item.id !== id)].slice(0, 10);
    });

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const typed = message.trim();
    const text = withPinnedHook(typed, pinned?.text ?? null);
    if (!text) {
      setProblem({ message: attachments.length ? "Say what to do with the screenshot." : "Say what to make with what you attached." });
      return;
    }
    setProblem(null);
    setStreaming(true);
    const sentMaterial = material;
    const sentPin = pinned;
    const sentAttachments = attachments;
    setMessage("");
    setMaterial(NO_MATERIAL);
    setPinned(null);
    setAttachments([]);
    // Give the words and the attachments back, so nothing she wrote is lost to a failed send.
    const giveBack = (why: Problem) => {
      setMessage(typed);
      setMaterial(sentMaterial);
      setPinned(sentPin);
      setAttachments(sentAttachments);
      setProblem(why);
    };

    let id = threadId;
    if (!id) {
      const started = await startThreadAction();
      if (!started.ok) {
        setStreaming(false);
        giveBack(started);
        return;
      }
      id = started.threadId;
      setThreadId(id);
    }

    // One id per message: a retried delivery is answered once, not twice.
    const requestId = crypto.randomUUID();
    const turnKey = `turn:${requestId}`;
    setCards((was) => withHerMessage(was, requestId, text, { photos: sentMaterial.photos.length, clip: sentMaterial.clip !== null, screenshots: sentAttachments.length }));
    touchThread(id, text);

    const controller = new AbortController();
    abort.current = controller;
    let heard = false;
    try {
      const response = await fetch(TURN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: id,
          message: text,
          requestId,
          // Ids only; the server looks each one up as hers.
          ...(hasMaterial ? { material: { photos: sentMaterial.photos.map((photo) => photo.id), ...(sentMaterial.clip ? { clip: sentMaterial.clip.id } : {}) } } : {}),
          // Shrunk in the browser; the server sniffs, screens and shows them to the model once.
          ...(sentAttachments.length ? { screenshots: sentAttachments.map((item) => item.dataUrl) } : {}),
          // Every picker she set, and nothing she did not.
          options: askOptions(choice),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const said = response.status === 429 ? "That is today's chat limit. It resets tomorrow." : "The agent could not answer just now. Try again in a moment.";
        setCards((was) => was.filter((card) => card.key !== requestId));
        giveBack({ message: said });
        return;
      }
      const done = await readTurnStream(response.body, (turnEvent) => {
        heard = true;
        if (turnEvent.type === "done") {
          setThreadId(turnEvent.threadId);
          return;
        }
        setCards((was) => applyEvent(was, turnEvent, turnKey));
      });
      if (!done) setCards((was) => applyEvent(was, { type: "error", message: STREAM_BROKE }, turnKey));
    } catch {
      if (controller.signal.aborted) return;
      if (heard) setCards((was) => applyEvent(was, { type: "error", message: STREAM_BROKE }, turnKey));
      else {
        setCards((was) => was.filter((card) => card.key !== requestId));
        giveBack({ message: "Could not reach the server. Check your connection and send again." });
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setStreaming(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) void send(event);
  };

  const accept = async (offerId: string) => {
    if (!threadId) return;
    setOfferBusy(offerId);
    setProblem(null);
    const result = await acceptOfferAction(threadId, offerId);
    setOfferBusy(null);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setCards((was) => settleOffer(was, offerId, "accepted", { jobId: result.jobId, kind: result.kind, credits: result.credits, ...(result.draftId ? { draftId: result.draftId } : {}) }));
  };

  const decline = async (offerId: string) => {
    if (!threadId) return;
    setOfferBusy(offerId);
    const result = await declineOfferAction(threadId, offerId);
    setOfferBusy(null);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setCards((was) => settleOffer(was, offerId, "declined"));
  };

  const newChat = () => {
    abort.current?.abort();
    setProblem(null);
    startSwitch(async () => {
      const started = await startThreadAction();
      if (!started.ok) {
        setProblem(started);
        return;
      }
      setThreadId(started.threadId);
      setCards([]);
      setOpen(null);
    });
  };

  const openThread = (id: string) => {
    if (id === threadId) {
      setOpen(null);
      return;
    }
    abort.current?.abort();
    setProblem(null);
    startSwitch(async () => {
      const result = await openThreadAction(id);
      if (!result.ok) {
        setProblem(result);
        return;
      }
      setThreadId(result.thread.id);
      setCards(threadCards(result.thread.messages));
      setOpen(null);
    });
  };

  const last = cards[cards.length - 1];

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="mb-4 flex items-center gap-2">
        <button type="button" onClick={() => setOpen("threads")} className={`${CHIP} ${CHIP_OFF} min-w-0`} aria-label="Your chats">
          <ChevronIcon className="size-3.5 shrink-0 rotate-90" />
          <span className="truncate">{current?.title ?? (cards.length ? threadTitle(cards.find((card) => card.kind === "her")?.text ?? "") : "New chat")}</span>
        </button>
        <button type="button" onClick={newChat} disabled={busy} className={`${CHIP} ${CHIP_OFF} ml-auto shrink-0 disabled:opacity-50`}>
          <PlusIcon className="size-3.5" />
          New chat
        </button>
      </div>

      <ol className="flex-1 space-y-6">
        {cards.length === 0 && (
          <li className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center text-sm text-muted">
            Try “Write me three hooks about slow mornings” or “Make a photo of me at a café”. It tells you the price before anything costs credits.
          </li>
        )}
        {cards.map((card, index) =>
          card.kind === "her" ? (
            <li key={card.key}>
              <UserBubble text={card.text} photos={card.photos} clip={card.clip} screenshots={card.screenshots} />
            </li>
          ) : (
            <li key={card.key}>
              <AgentBubble>
                <TurnBody parts={card.parts} working={streaming && index === cards.length - 1} offerBusy={offerBusy} onAccept={accept} onDecline={decline} />
              </AgentBubble>
            </li>
          ),
        )}
        {streaming && last?.kind === "her" && (
          <li>
            <AgentBubble>
              <p className="text-sm text-muted">Thinking…</p>
            </AgentBubble>
          </li>
        )}
        <div ref={bottom} />
      </ol>
      {/* The box is fixed on a phone, so the chat keeps room under its last message to scroll clear of it. */}
      {!folded && <div aria-hidden className="md:hidden" style={{ height: boxHeight }} />}

      <form
        onSubmit={(event) => void send(event)}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        hidden={folded}
        ref={box}
        // Same box as the first chat: fixed above the phone bar, sticky in the column from md up.
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-20 rounded-xl border border-line bg-surface p-3 shadow-card md:sticky md:inset-x-auto md:bottom-4 md:mt-8"
      >
        {(hasMaterial || pinned || attachments.length > 0) && (
          <ul className="mb-2 flex flex-wrap items-center gap-2">
            {[...(material.clip ? [material.clip] : []), ...material.photos].map((item, index) => (
              <li key={item.id} className="relative">
                <span className="block w-14">
                  <MediaTile
                    kind={item.kind === "clip" ? "video" : "image"}
                    src={item.kind === "clip" ? `${item.src}#t=0.1` : item.src}
                    alt={item.title || (item.kind === "clip" ? "A clip" : "A photo")}
                    ratio="4:5"
                    badge={<Badge tone="accent">{item.kind === "clip" ? "Clip" : material.photos.length > 1 ? String(index + (material.clip ? 0 : 1)) : "Photo"}</Badge>}
                  />
                </span>
                <button type="button" onClick={() => removeMaterial(item.id)} aria-label={`Remove the ${item.kind}`} className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-xs text-canvas">
                  ×
                </button>
              </li>
            ))}
            {attachments.map((item) => (
              <li key={item.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.dataUrl} alt={item.name} className="h-20 w-16 rounded-md border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((other) => other.id !== item.id))}
                  aria-label={`Remove ${item.name}`}
                  className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-xs text-canvas"
                >
                  ×
                </button>
              </li>
            ))}
            {pinned && (
              <li className="inline-flex max-w-full items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs text-ink">
                <span className="min-w-0 truncate" title={pinned.text}>
                  Hook: “{oneLineHook(pinned.text)}”
                </span>
                <button type="button" onClick={() => setPinned(null)} aria-label="Unpin the hook" className="text-muted hover:text-ink">
                  ×
                </button>
              </li>
            )}
          </ul>
        )}
        <label className="sr-only" htmlFor="agent-v2-message">
          Your message
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="agent-v2-message"
            name="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={2}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={hasMaterial || attachments.length ? "What to make with this…" : "Ask for hooks, a post, a photo or a reel, or paste a screenshot…"}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base text-ink placeholder:text-muted/70 sm:text-sm"
          />
          <button type="submit" disabled={!canSend} aria-label={streaming ? "Sending" : "Send. Free."} title="Send. Messages are free." className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
            <ArrowIcon className="size-5 -rotate-90" />
          </button>
        </div>
        <div className="mt-2 flex flex-nowrap items-center gap-1.5 sm:gap-2">
          <span className="relative shrink-0">
            <button type="button" onClick={() => setPlusOpen((was) => !was)} aria-expanded={plusOpen} aria-label="Add from your library or upload a photo" title="Add" className={`${CHIP} ${CHIP_OFF} px-2`}>
              <PlusIcon className="size-4" />
            </button>
            {plusOpen && (
              <span role="menu" className="absolute bottom-full left-0 z-30 mb-2 flex w-56 flex-col rounded-lg border border-line bg-surface p-1 text-sm shadow-card">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusOpen(false);
                    setOpen("library");
                  }}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-left text-ink hover:bg-canvas"
                >
                  <ImageIcon className="size-4" />
                  Add from your library
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => {
                    setPlusOpen(false);
                    fileInput.current?.click();
                  }}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-left text-ink hover:bg-canvas disabled:opacity-50"
                >
                  <UploadIcon className="size-4" />
                  Upload a screenshot{attachments.length ? ` (${attachments.length} of ${MAX_ATTACHMENTS})` : ""}
                </button>
              </span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </span>
          <button type="button" onClick={() => setOpen("text")} className={`${CHIP} ${CHIP_OFF} min-w-0`} aria-label={`Text style: ${textChipLabel(choice.textStyle, choice.textSize, choice.lowercase)}`}>
            <span className="truncate">
              {textChipLabel(choice.textStyle, choice.textSize, choice.lowercase)
                .split(" · ")
                .map((part, index) => (
                  // "Text" is the chip's name on a wide screen; a phone shows the look alone.
                  <span key={part} className={index === 0 ? "hidden sm:inline" : undefined}>
                    {index > 1 && <span className="text-muted"> · </span>}
                    {index === 1 && <span className="hidden text-muted sm:inline"> · </span>}
                    {part}
                  </span>
                ))}
            </span>
          </button>
          <button type="button" onClick={() => setOpen("model")} className={`${CHIP} ${CHIP_OFF} min-w-0`} aria-label={`Model: ${modelChipLabel(choice, true)}`}>
            <span className="truncate sm:hidden">{modelChipLabel(choice, true, true).split(" · ")[0]}</span>
            <span className="hidden truncate sm:inline">{modelChipLabel(choice, true)}</span>
          </button>
          <span className="hidden min-w-0 truncate text-xs text-muted lg:inline">Messages are free. Anything paid asks first.</span>
          <button type="button" onClick={() => setFolded(true)} aria-label="Minimise the message box" title="Minimise" className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink">
            <ChevronIcon className="size-4 -rotate-90" />
          </button>
        </div>
        {problem && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ResultMessage ok={false}>{problem.message}</ResultMessage>
            {problem.fix && (
              <Link href={problem.fix.href} className={buttonClass("spend", "sm")}>
                {problem.fix.label}
              </Link>
            )}
          </div>
        )}
      </form>

      {folded && (
        <button
          type="button"
          onClick={() => setFolded(false)}
          aria-label={message.trim() || hasMaterial || pinned || attachments.length ? "Open the message box: your draft is still there" : "Open the message box"}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 grid size-14 place-items-center rounded-full bg-ink text-canvas shadow-card transition-transform hover:scale-105 md:right-6 md:bottom-6"
        >
          <SparkIcon className="size-6" />
          {(message.trim() || hasMaterial || pinned || attachments.length > 0) && <span aria-hidden className="absolute top-1 right-1 size-3 rounded-full border-2 border-ink bg-accent" />}
        </button>
      )}

      {open === "library" && <LibraryPicker onAdd={addMaterial} onPickHook={setPinned} onClose={() => setOpen(null)} />}
      {open === "threads" && <ThreadList threads={threads} currentId={threadId} busy={switching} onOpen={openThread} onNew={newChat} onClose={() => setOpen(null)} />}
      {open === "model" && <ModelPanel choice={choice} onChange={setChoice} agentOn attached={attachedIds} hook={pinned?.text ?? null} onClose={() => setOpen(null)} />}
      {open === "text" && (
        <TextStylePicker
          value={{ style: choice.textStyle, size: choice.textSize, lowercase: choice.lowercase }}
          onChange={(change) =>
            setChoice((current) => ({
              ...current,
              ...(change.style ? { textStyle: change.style } : {}),
              // Set here, so it goes with the message and wins over her words.
              ...(change.size ? { textSize: change.size, textSizePicked: true } : {}),
              ...(change.lowercase !== undefined ? { lowercase: change.lowercase, lowercasePicked: true } : {}),
            }))
          }
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function UserBubble({ text, photos, clip, screenshots }: { text: string; photos: number; clip: boolean; screenshots: number }) {
  const attached = [clip ? "a clip" : "", photos ? (photos === 1 ? "a photo" : `${photos} photos`) : "", screenshots ? (screenshots === 1 ? "a screenshot" : `${screenshots} screenshots`) : ""]
    .filter(Boolean)
    .join(" and ");
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm text-ink">{text}</p>
      {attached && <p className="text-xs text-muted">With {attached}</p>}
    </div>
  );
}

function AgentBubble({ children }: { children: React.ReactNode }) {
  return <Card className="max-w-[92%] px-4 py-3 sm:max-w-[85%]">{children}</Card>;
}

function TurnBody({
  parts,
  working,
  offerBusy,
  onAccept,
  onDecline,
}: {
  parts: TurnPart[];
  working: boolean;
  offerBusy: string | null;
  onAccept: (offerId: string) => void;
  onDecline: (offerId: string) => void;
}) {
  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        const key = `${index}:${part.kind}`;
        if (part.kind === "tools") return <ToolLines key={key} labels={part.labels} />;
        if (part.kind === "text") return <p key={key} className="whitespace-pre-line text-sm text-ink">{part.text}</p>;
        if (part.kind === "fact") return <FactLine key={key} text={part.text} />;
        if (part.kind === "error") return <ResultMessage key={key} ok={false}>{part.message}</ResultMessage>;
        if (part.kind === "offer")
          return <OfferCard key={part.offer.id} offer={part.offer} busy={offerBusy === part.offer.id} onAccept={() => onAccept(part.offer.id)} onDecline={() => onDecline(part.offer.id)} />;
        return <JobCard key={part.job.jobId} job={part.job} />;
      })}
      {working && waitingForWords([{ kind: "turn", key: "", parts }]) && <p className="text-sm text-muted">Thinking…</p>}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  image: "Photo",
  clip: "Clip",
  reel: "Reel",
  carousel: "Carousel",
  text_photo: "Words on a photo",
};

const WORKING_LABEL: Record<string, string> = {
  image: "Making the photo. About a minute.",
  clip: "Making the clip. A few minutes.",
  reel: "Making the reel. A few minutes.",
  carousel: "Drawing the slides…",
  text_photo: "Putting the words on…",
};

const mediaSrc = (id: string) => `/api/media/${id}`;

/** A job the agent started or an offer bought, polled like every job, drawn like the first chat's run cards. */
function JobCard({ job }: { job: JobRef }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{KIND_LABEL[job.kind] ?? "Job"}</Badge>
        {job.credits > 0 ? <Badge tone="spend">{creditWord(job.credits)}</Badge> : <Badge tone="good">Free</Badge>}
      </div>
      <JobStatus
        jobId={job.jobId}
        url={jobPollUrl(job)}
        read={(body) => agentJobStatus(body as AgentView, job.kind)}
        workingLabel={WORKING_LABEL[job.kind] ?? "Working on it…"}
      >
        {(done) => <JobResult kind={job.kind} mediaIds={done.mediaIds} draftId={job.draftId ?? done.draftId ?? null} />}
      </JobStatus>
    </div>
  );
}

function JobResult({ kind, mediaIds, draftId }: { kind: string; mediaIds: string[]; draftId: string | null }) {
  if (kind === "reel") {
    const reelId = mediaIds[mediaIds.length - 1];
    if (!reelId) return null;
    return (
      <div className="space-y-2">
        <div className="group relative w-40">
          <video src={`${mediaSrc(reelId)}#t=0.1`} controls loop playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg border border-line bg-black" />
          <DownloadCorner mediaId={reelId} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ThumbsUp mediaIds={[reelId]} />
          <a href={downloadHref(reelId)} download className={buttonClass("quiet", "sm")}>
            Download
          </a>
          <Link href="/reels" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
            Add it to the calendar
          </Link>
        </div>
      </div>
    );
  }
  if (kind === "clip") {
    return (
      <div className="space-y-2">
        <ul className="flex flex-wrap gap-2">
          {mediaIds.map((id) => (
            <li key={id} className="w-36">
              <MediaTile kind="video" src={mediaSrc(id)} ratio="9:16" controls download={id} />
            </li>
          ))}
        </ul>
        <ThumbsUp mediaIds={mediaIds} />
      </div>
    );
  }
  if (kind === "carousel") {
    // A set is hearted by its draft, not its slides.
    return (
      <div className="space-y-2">
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {mediaIds.slice(0, 4).map((id) => (
            <li key={id} className="w-24 shrink-0">
              <MediaTile kind="image" src={mediaSrc(id)} alt="A slide" ratio="4:5" download={id} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {draftId && <ThumbsUpSet draftId={draftId} />}
          <Link href="/carousels" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
            Open your sets
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {mediaIds.map((id) => (
          <li key={id}>
            <MediaTile kind="image" src={mediaSrc(id)} alt={kind === "text_photo" ? "Your photo with the words on it" : "The photo just made"} ratio="4:5" download={id} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <ThumbsUp mediaIds={mediaIds} />
        <Link href="/library" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
          Open the Library
        </Link>
      </div>
    </div>
  );
}

/* Thumbs up is the Library's heart under another name: it puts the item in
   Favorites, and a favorite is what the agent learns her voice from. */
function ThumbsUp({ mediaIds }: { mediaIds: string[] }) {
  if (mediaIds.length === 0) return null;
  return <ThumbsButton set={(on) => Promise.all(mediaIds.map((id) => setFavoriteAction(id, on)))} />;
}

/** A set is one draft, so it takes one heart. */
function ThumbsUpSet({ draftId }: { draftId: string }) {
  return <ThumbsButton set={async (on) => [await setSetFavoriteAction(draftId, on)]} />;
}

function ThumbsButton({ set }: { set: (on: boolean) => Promise<{ ok: boolean; message?: string }[]> }) {
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      const next = !on;
      const results = await set(next);
      const failed = results.find((result) => !result.ok);
      if (failed) setProblem(failed.message ?? "That did not save. Try again.");
      else {
        setProblem(null);
        setOn(next);
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant={on ? "primary" : "quiet"} size="sm" onClick={toggle} disabled={pending} aria-pressed={on} title="Adds it to Favorites. The agent writes more like your favorites. Free.">
        <ThumbIcon className="size-4" filled={on} />
        {on ? "In Favorites" : "More like this"}
      </Button>
      {problem && (
        <span role="status" className="text-xs text-danger">
          {problem}
        </span>
      )}
    </span>
  );
}

function ThumbIcon({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M7.5 10.5v9h-3v-9h3Z" fill={filled ? "currentColor" : "none"} />
      <path d="M7.5 10.5 11 4a2 2 0 0 1 2.9 2.2L13 10h5.3a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}
