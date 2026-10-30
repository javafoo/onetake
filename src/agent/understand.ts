import { ContentBlockedError, type InlineImage } from "@/ai/gemini";
import { generateText } from "@/ai/text";
import { brandOff } from "@/content/brand-scope";
import { withEnglishFields } from "@/content/languages";
import type { BrandProfile } from "@/content/hooks";
import { TEXT_STYLE_IDS, normalizeTextStyle } from "@/content/text-styles";

import { layoutFrom, type Layout } from "@/carousel/spec";

import { MAX_PHOTOS, type AgentRequest } from "./plan";
import { routeHookFields } from "./hook-level";
import { refusesSecondLine } from "./second-line";
import { textLookFromMessage, withTextLook } from "./text-look";
import { photoLikeScreenshot, quotePhotoFromReading } from "./photo-words";
import { textPhotoFromReading, wordsForTextPhoto } from "./text-photo";

/* The first thing the agent does with a message: decide what she is asking
   for and turn it into a request the run can follow. Anything that is not a
   reel, photos, a set or words on her photo gets a short answer and costs
   nothing. */

/**
 * `words` is what she gave to be put on a picture, when she gave any: the
 * text_photo request's own words, or, on any other request, what the reader
 * found, so the Slides tab can still turn "photos" into words on her photo.
 */
export type Understanding = { kind: "run"; request: AgentRequest; reply: string; words?: string } | { kind: "chat"; reply: string };

/** What she attached from her library with +, which the reader cannot see but must know about. */
export type Attachments = { photos: number; clip: boolean };

/** An earlier message and what it became, so a follow-up can refine it. */
export type Earlier = { message: string; request: AgentRequest | null; status: string };

/** Her message just before this one when it was answered in chat, not run: a question asked back, say. */
export type LastChat = { message: string; reply: string };

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["reel", "photos", "carousel", "text_photo", "chat"] },
    words: { type: "string" },
    quote: { type: "boolean" },
    brief: { type: "string" },
    scene: { type: "string" },
    framing: { type: "string" },
    footage: { type: "string", enum: ["auto", "new"] },
    cue: { type: "string", enum: ["auto", "yes", "no"] },
    talking: { type: "boolean" },
    style: { type: "string", enum: [...TEXT_STYLE_IDS] },
    count: { type: "integer" },
    photoMode: { type: "string", enum: ["one", "set", "related", "various"] },
    format: { type: "string", enum: ["carousel", "story"] },
    layout: { type: "string", enum: ["mixed", "photos", "split", "grid"] },
    look: { type: "string", enum: ["house", ...TEXT_STYLE_IDS] },
    exact: { type: "string" },
    template: { type: "string" },
    reference: { type: "string" },
    slides: { type: "integer" },
    reply: { type: "string" },
  },
  required: ["kind", "words", "quote", "brief", "scene", "framing", "footage", "cue", "talking", "style", "count", "photoMode", "format", "layout", "look", "exact", "template", "reference", "slides", "reply"],
};

const SYSTEM = `You are the content agent inside a creator's tool. The creator has an AI avatar (a woman whose face stays the same in every picture); you make her Instagram content.

What you can make:
- A reel: a hook (the only text on screen) over a silent five-second clip of her, with a caption that pays the hook off. You write the hook and caption, make a photo of her, animate it, render the reel. Optionally a short second line ("Read the caption") pops in once the hook has been read. A TALKING reel is the other kind: she says one line to camera with sound, and the hook sits over it as a headline.
- Photos: one, or up to ${MAX_PHOTOS}. A "set" is one shoot (same place, same outfit, different poses and framings). "related" is a sequence of scenes that belong together (a morning, a trip, a work day). "various" is unrelated scenes. "one" is a single photo.
- A quote post: one new photo of her with a quote drawn on a copy of it. The quote is hers if she gives one; otherwise you write it in her voice.
- A carousel (swipe post) or a story sequence: written and drawn from her brand, about a topic.
- Words on her photo: one of her own photos, attached from her library, with words she gives (a quote, a caption, a line) drawn on it in her text style. Free. No new photo is made.

Classify the message and fill every field (use "" or 0 or false where a field does not apply; framing is "" except for a new photo like a screenshot; quote is false except for a quote post):
- kind "reel": she wants a reel, video, clip-with-hook or post about something. brief: what it is about, one to three sentences, keeping her wording, angle, audience notes and tone. scene: the place or activity she asked for under the hook, or "". footage: "new" only if she asks for a new photo, new clip or fresh footage, or names a scene; else "auto". cue: "yes" if she asks for a second line, pop-up or "read caption" text; "no" if she says not to ("no second line", "no read the caption", "just the hook"); else "auto". talking: true only if she asks for her to talk, speak, say something, or a talking-head / talk-to-camera / voice video. style: the text look. "serif" if she asks for the elegant, minimal, editorial, dimmed or dark-overlay look, or a serif with no box; "serif_boxed" for a serif in white boxes; "bold" for plain white text with no box; "pastel" for pastel or yellow text; otherwise "boxed" (black text in white boxes, the default).
- kind "photos": she wants a photo, picture, image, selfie, shoot, set or several photos. brief: what the photos show and the feel she wants, in her words. count: how many (1 if unsaid; never more than ${MAX_PHOTOS}). photoMode: "set" for a shoot or several of one look; "related" for a story or sequence; "various" for different scenes; "one" for a single photo. scene: the place or activity if named, else "".
- A quote post with no photo of hers attached with +: "a quote post", "a single image quote post", "a quote image", "a quote graphic", "put this quote on a photo", "add this quote: …", "a photo with these words on it": kind "photos", count 1, photoMode "one", quote true. One picture, never a carousel: a post is a carousel only when she says carousel, slides, swipe or story sequence. words: her quote exactly as she gave it (in quotes, or typed after the ask), or "" when she gave none. brief: what the quote says or is about, in her words, and nothing about the picture. scene: the picture of her that suits the quote, in one sentence (a place, a moment, a mood). style: the look of the words, as for a reel's text ("boxed" unless she asks for another).
- A new photo of her LIKE a screenshot ("a photo of her like this", "same angle", "same vibe", "like the screenshot") when she has not attached a photo of her own with +: kind "photos", count 1, photoMode "one". The screenshot shows someone else; you describe HER version of its picture. brief: what the new photo shows, precisely enough to recreate the picture without seeing it: what part of her fills the frame and where the frame cuts (for example "from the chin to mid-chest, face at the top edge"), how close the camera is, the camera angle and height, her pose, the kind of clothing, the setting, the light, the mood, skin details such as sweat or glow, plus everything she added in her message; and that the picture has no writing on it. Never describe the other person's identity (face, hair colour, skin tone, tattoos, marks, name) and never put the screenshot's words in brief. What she says about the framing or the picture wins over the screenshot (if she asks for her face and upper chest, her face is in the frame even when the screenshot cuts it off). A photo of her always shows her face: when the screenshot crops the face out, keep its angle, closeness and mood but frame from the top of her head to her upper chest. Never frame a picture on her chest, cleavage or body alone. framing: the camera angle, distance, crop and pose alone, in one or two plain sentences, with her changes applied. style: the look of the words on the screenshot: white sans text with no box is "bold"; white serif with no box is "serif"; pale yellow text is "pastel"; dark text in white boxes is "boxed"; serif in white boxes is "serif_boxed". words: ALL the words written over the screenshot's picture, exactly as written, with their case and punctuation, in reading order (leave out app chrome, account names, counts and watermarks), or "". This is kind "photos" even when she asks for the words on it: the words are drawn on the new photo afterwards.
- kind "carousel": she says carousel, swipe post, slides, or a story sequence. A "post" or a "quote post" alone is not a carousel. brief: the topic in her words. format: "story" only if she says story sequence or stories; else "carousel". look: the text look. "boxed" if she asks for the standard look, white boxes, or captions on the photo; "pastel" for the pastel or yellow look; "serif" for a serif or elegant look with no boxes; "serif_boxed" for a serif in white boxes; "bold" for plain white text with no boxes; otherwise "house". layout: "split" if she asks for half and half, two photos per slide, or a top photo and a bottom photo; "grid" if she asks for a 2x2 or four-photo grid, or a four-photo cover with one line per photo after it; "photos" if she wants every slide to be a photo (all photo slides, photos only, no plain or text-only slides, captions on photos throughout); otherwise "mixed".
- kind "text_photo": she asks to put, add, write, place or overlay text, a quote, words, a line or a caption ON a photo or picture she has attached with + (not a new photo like a screenshot, and not a quote post with nothing attached, both above) ("add this quote to this photo", "put this on the photo", "write X on it", "caption this photo with…"). This is never a request for a new photo. words: the words to draw, copied exactly with her case, punctuation and line breaks: the text she put in quotes, or typed after the ask; if there is none, ALL the words on her screenshot, in reading order, each line of it on its own line (leave out app chrome, account names, counts and watermarks); if there are none at all, "". brief: one sentence saying what she asked for.
- kind "chat": anything else (a question, a greeting, feedback). reply: a short plain answer; if asked what you can do, say it in two sentences.

If what she asks for is not something listed above (a video from words alone, an edit to the photo itself such as removing a person or changing her clothes, a voiceover, a logo, a post scheduled for her), use kind "chat": say plainly that you can't make that and what she can do instead with what you can make. Never make something different in its place: a request for words on a photo she attached, or one she points at ("this photo", "my photo"), is never a new photo, and a request you cannot do is never another request you can.

words: fill it for text_photo and for a photo like a screenshot as above. For any other kind, put there the words she gave for the screen (in quotes or after "the words", "the text", "the quote") exactly, or "".

Three levels for words she points at. Pick one; the other two fields are "".
- exact: ONLY when she says exact, word for word, same words, copy this exactly, or puts the words in quotes. Copy them here exactly as written, including her line breaks.
- template: when she attaches a screenshot and points at its words without asking for them exactly ("with this hook", "this hook", "like this", "for me", "copy this"). Put ALL the words written on the post here, not just its headline: every line in reading order, each box or line of the original on its own line, a blank line between separate groups (the headline, then each list item or block). They are rewritten for her line by line later, so copy them as they are, names and all.
- neither: "make my version", "something like this but about…", or a screenshot with no instruction. Use reference only (below).
For exact and template alike: leave out app chrome, the account name, view counts and watermarks. A closing line that only points elsewhere ("Read caption for details", "Link in bio") is not part of either: set cue to "yes" instead. The brief describes what goes around the words.

reference and slides: when she attaches screenshots of a post (or pastes its text) as something to make her own version of, read every word on them in order and copy it into reference: the hook first, then, for a carousel, one line per slide written as "Slide 1: …". The reference is followed for its SHAPE (how the hook opens, what it promises, how many slides, what each does), never its words or facts, so brief must say what HER version is about. If she asks for the exact words, put the hook or cover text in exact as well. slides: how many slides the reference has, or 0. From what the screenshots look like, set look: white boxes with dark sans text on the photo is "boxed"; white boxes with serif text is "serif_boxed"; pale yellow text on a darkened photo is "pastel"; white serif on a darkened photo is "serif"; white sans on a darkened photo is "bold"; otherwise "house". If the slides in the screenshots are two photos stacked with a short line on each, set layout to "split". If the first slide is four photos in a grid under a title, set layout to "grid". Otherwise, if every slide in the screenshots is a photo with the words on it, set layout to "photos". A screenshot with no post on it is ignored. Never copy a name, a number or a claim from a screenshot into brief as if it were hers.

Follow-ups: you are shown her recent requests. If the message corrects or refines the last one ("without the phone", "three different outfits", "make it elegant", "shorter"), treat it as that same request with the change applied: keep everything from the earlier request that she did not change, and write the whole thing into brief again. Only a message about something new starts from nothing.

Write the brief in plain descriptive words, not slang: "hot girl walk" is "a casual walk outside, dressed up a little"; "POV" or "0.5 selfie" is "a wide-angle selfie from her own arm's length, the phone itself not in frame". Every constraint she states must be in the brief word for word in meaning: what must not appear in the picture, the camera angle, the shot kind, how many, how different from each other.

reply, for a run: one plain sentence saying what you are about to make, no hype, no emoji, for example "Writing a hook about why she never films herself, then making the clip and the reel." You make one thing per message; if she asks for several, make the first and say so.`;

function attachedLine(attached: Attachments): string {
  if (!attached.photos && !attached.clip) return "";
  const photos = attached.photos ? `${attached.photos === 1 ? "one photo" : `${attached.photos} photos`} from her library` : "";
  const clip = attached.clip ? "a clip from her library" : "";
  return `She also attached ${[photos, clip].filter(Boolean).join(" and ")} with + (not shown to you): her own material, to use as it is.`;
}

function clampCount(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.min(MAX_PHOTOS, Math.round(value)) : 1;
}

/** Said when Google's filter refuses to read her screenshot. */
export const SCREENSHOT_BLOCKED_REPLY =
  "Google's safety filter wouldn't read that screenshot, so nothing was made or charged. It usually happens with a close crop of skin. Describe the photo in words instead, and put the text in quotes, for example: a photo of her in a sports top, face and upper chest, sweaty after a workout, with the words \"this era is called…\".";

/** The reader's rules. Her words are copied as written; the fields the planners and the chat read come back in English. */
export function readerSystem(language?: string): string {
  return withEnglishFields(SYSTEM, language, "brief, scene, framing and reply", "words, exact, template and reference");
}

/** What the reader is told about the account. With the brand off (a scoped profile), nothing of it. */
export function accountLine(profile: BrandProfile): string {
  if (brandOff(profile)) return "This message is written without the account's brand: read it for what she asks, not for any niche or offer.";
  return `The account: niche "${profile.niche}", audience "${profile.audience}", offer "${profile.offer}", comment keyword "${profile.keyword}".`;
}

export async function understand(
  message: string,
  profile: BrandProfile,
  earlier: Earlier[] = [],
  images: InlineImage[] = [],
  attached: Attachments = { photos: 0, clip: false },
  lastChat: LastChat | null = null,
): Promise<Understanding> {
  const history = earlier
    .slice(-4)
    .map((item) => `- "${item.message.slice(0, 300)}" -> ${item.request ? `${item.request.kind}: ${item.request.brief.slice(0, 300)}` : "answered, nothing made"} (${item.status})`)
    .join("\n");
  const result = await readMessage().catch((error: unknown) => {
    if (!(error instanceof ContentBlockedError)) throw error;
    return null;
  });
  if (!result) {
    /* Google's filter refused the input. With a screenshot that is nearly
       always the picture itself (a close crop of skin reads as explicit to
       it), so she is told what happened and how to ask without it, instead of
       a generic error. Nothing was spent beyond the refused read. */
    return {
      kind: "chat",
      reply: images.length
        ? SCREENSHOT_BLOCKED_REPLY
        : "Google's safety filter wouldn't read that message, so nothing was made or charged. Try saying it another way.",
    };
  }
  async function readMessage() {
    return generateText<{
    kind: "reel" | "photos" | "carousel" | "text_photo" | "chat";
    words: string;
    quote: boolean;
    brief: string;
    scene: string;
    framing: string;
    footage: "auto" | "new";
    cue: "auto" | "yes" | "no";
    talking: boolean;
    style: string;
    count: number;
    photoMode: "one" | "set" | "related" | "various";
    format: "carousel" | "story";
    layout: Layout;
    look: string;
    exact: string;
    template: string;
    reference: string;
    slides: number;
    reply: string;
  }>({
    /* The brief, scene and framing feed the scene planner and the photo prompt
       writer, which work in English; the writers are told her language
       separately. Her words are copied as she wrote them. The reply is ours
       to her, and the interface is English for now. */
    system: readerSystem(profile.language),
    schema: SCHEMA,
    thinking: "low",
    prompt: [
      accountLine(profile),
      history ? `Her recent requests, oldest first, and what each became:\n${history}` : "",
      /* A question answered in chat is not a run, so it is not in the history
         above: without it "can you write them for me" has nothing to refer to. */
      lastChat
        ? `Just before this, she said: "${lastChat.message.slice(0, 400)}"\nand you answered, making nothing yet: "${lastChat.reply.slice(0, 400)}"\nIf this message answers or continues that, read the two together as one request.`
        : "",
      images.length ? `She attached ${images.length === 1 ? "one screenshot" : `${images.length} screenshots`} (shown above). Read them as described.` : "",
      attachedLine(attached),
      `Message from the creator:\n${message.trim() || "(no words, only the screenshots: make her version of what they show)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    images,
  });
  }

  /* A new photo like her screenshot, with its words drawn on after: before
     words-on-her-photo, which would ask her to attach a photo she does not
     mean to use. */
  const like = photoLikeScreenshot({
    message,
    kind: result.kind,
    words: result.words || result.exact || result.template,
    brief: result.brief,
    framing: result.framing ?? "",
    style: result.style,
    screenshots: images.length,
    photos: attached.photos,
  });
  if (like) return like.kind === "run" ? { ...like, request: withTextLook(like.request, textLookFromMessage(message)) } : like;

  /* A quote post with nothing of hers attached: one new photo, the quote on a
     copy. Before words-on-her-photo, which would ask her to attach a photo
     she never meant to use. */
  const quoted = quotePhotoFromReading({
    message,
    kind: result.kind,
    quote: result.quote === true,
    words: result.words || result.exact,
    brief: result.brief,
    scene: result.scene,
    style: result.style,
    screenshots: images.length,
    photos: attached.photos,
  });
  if (quoted) return quoted.kind === "run" ? { ...quoted, request: withTextLook(quoted.request, textLookFromMessage(message)) } : quoted;

  const onPhoto = textPhotoFromReading({ message, kind: result.kind, words: result.words, brief: result.brief, style: result.style, screenshots: images.length, photos: attached.photos, lastChat });
  // "small text", "lowercase": read in code from her own words, for every request that draws words.
  const look = textLookFromMessage(message);
  if (onPhoto) return onPhoto.kind === "run" ? { ...onPhoto, request: withTextLook(onPhoto.request, look) } : onPhoto;
  const found = wordsForTextPhoto(message, result.words, images.length > 0) ?? undefined;

  const brief = result.brief.trim();
  const scene = result.scene.trim() || undefined;
  const unquote = (text: string | undefined) => (text ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim() || undefined;
  /* Which of the three levels her words asked for is decided here, in code,
     from her message; the reader's copy of the words is moved to that field. */
  const { exact, template, reference: routedReference } = routeHookFields(message, images.length > 0, {
    exact: unquote(result.exact),
    template: unquote(result.template)?.slice(0, 1500),
    reference: result.reference.trim().slice(0, 2000) || undefined,
  });
  const reference = routedReference;
  const slides = Number.isFinite(result.slides) && result.slides >= 3 ? Math.min(10, Math.round(result.slides)) : undefined;
  const reply = result.reply.trim();
  if (result.kind === "chat" || !brief) {
    return { kind: "chat", reply: reply || "I can make a reel, photos or a carousel: tell me what it should be about." };
  }
  if (result.kind === "photos") {
    const count = clampCount(result.count);
    const mode = count === 1 ? "one" : result.photoMode === "one" ? "set" : result.photoMode;
    return { kind: "run", request: { kind: "photos", brief, count, mode, scene }, reply: reply || "Making the photos.", ...(found ? { words: found } : {}) };
  }
  if (result.kind === "carousel") {
    /* "house" is the only word that means no kit. Anything else, a legacy
       word like "standard" included, is read as the text look it names. */
    const kit = result.look === "house" ? undefined : normalizeTextStyle(result.look);
    return {
      kind: "run",
      request: withTextLook(
        {
          kind: "carousel",
          brief,
          format: result.format === "story" ? "story" : "carousel",
          kit,
          cover: exact,
          ...(template ? { coverTemplate: template } : {}),
          reference,
          slides,
          ...(result.layout === "mixed" ? {} : { layout: layoutFrom(result.layout) }),
        },
        look,
      ),
      reply: reply || "Writing and drawing the set.",
    };
  }
  return {
    kind: "run",
    request: withTextLook({
      kind: "reel",
      brief,
      scene,
      footage: result.footage === "new" ? "new" : "auto",
      // Her plain "no second line" wins over whatever the model read.
      cue: refusesSecondLine(message) ? "no" : result.cue === "yes" || result.cue === "no" ? result.cue : "auto",
      talking: Boolean(result.talking),
      style: normalizeTextStyle(result.style),
      hook: exact,
      ...(template ? { template } : {}),
      reference,
    }, look),
    reply: reply || "Making the reel.",
  };
}
