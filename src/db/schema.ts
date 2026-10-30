import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/* The production data model. Every row that belongs to a customer carries
   user_id (the Clerk user id), and every query must filter on it: there is no
   other tenant boundary. Media bytes live in private Blob storage; rows here
   hold the pathname. */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email").notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  /* When this account spent its one free photo. Null means it still has it —
     including for every account that existed before the column did, which is
     the behaviour we want. The claim is a conditional UPDATE against this
     column, so two taps cannot both get a photo: see `src/data/freebie.ts`. */
  freePhotoUsedAt: timestamp("free_photo_used_at", { withTimezone: true }),
  /* When she dismissed the "you are set up" note on Overview. Null until all
     five steps are done and she has seen the note once. */
  setupSeenAt: timestamp("setup_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const avatars = pgTable("avatars", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["twin", "avatar"] }).notNull(), // twin = the user's own face, avatar = a designed persona
  /** IdentityLock from src/identity/build.ts */
  lock: jsonb("lock"),
  /** Descriptor drafted by a vision model; a starting point for the lock, never sent to image prompts. */
  descriptor: jsonb("descriptor"),
  /** A twin requires the user's recorded consent that the photos are of themselves. */
  likenessConsentAt: timestamp("likeness_consent_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("avatars_user_idx").on(t.userId)]);

/* A folder in the library. One level deep, by design: a creator files a shoot
   or a campaign, not a tree. A folder is not typed by kind — the tabs are the
   kind filter — so "Beach day" can hold the photos, the clips animated from
   them and the reels printed on those, and each tab shows its own share. */
export const folders = pgTable("folders", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("folders_user_idx").on(t.userId, t.createdAt)]);

export const media = pgTable("media", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").references(() => avatars.id, { onDelete: "cascade" }),
  /** Null is "not in a folder". Deleting a folder sends its items back there rather than deleting them. */
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["upload", "reference", "image", "clip", "reel", "slide"] }).notNull(),
  pathname: text("pathname").notNull(), // Blob pathname: users/<userId>/<kind>/<id>.<ext>
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: numeric("duration_seconds", { precision: 8, scale: 3 }),
  /** Prompt, verdict, source media id, face zone cache, and so on. */
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  index("media_user_kind_idx").on(t.userId, t.kind, t.createdAt),
  index("media_user_folder_idx").on(t.userId, t.folderId),
]);

export const avatarReferences = pgTable("avatar_references", {
  id: id(),
  avatarId: uuid("avatar_id").notNull().references(() => avatars.id, { onDelete: "cascade" }),
  mediaId: uuid("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["front", "three_quarter", "profile", "full_body", "expression"] }).notNull(),
  source: text("source", { enum: ["original", "generated"] }).notNull(),
  approved: boolean("approved").notNull().default(false),
  /** Order sent to the image model. Originals first: the first reference sets the look. */
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("avatar_references_avatar_idx").on(t.avatarId, t.position)]);

export const brandProfiles = pgTable("brand_profiles", {
  avatarId: uuid("avatar_id").primaryKey().references(() => avatars.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** BrandProfile from src/content/hooks.ts */
  profile: jsonb("profile").notNull(),
  /** Brief from src/brief/build.ts, or the one compiled by onboarding. */
  brief: jsonb("brief"),
  /** TopicSuggestion[] from src/carousel/topics.ts: written once per distinct brand. */
  topics: jsonb("topics"),
  /** Hash of the brand fields the suggestions were written from. Any other change leaves them alone. */
  topicsKey: text("topics_key"),
  updatedAt: updatedAt(),
});

export const onboardingSessions = pgTable("onboarding_sessions", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  /** InterviewState from src/onboarding */
  state: jsonb("state").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const drafts = pgTable("drafts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").notNull().references(() => avatars.id, { onDelete: "cascade" }),
  format: text("format", { enum: ["reel", "carousel", "story"] }).notNull().default("reel"),
  hook: text("hook").notNull(),
  angle: text("angle").notNull().default(""),
  caption: text("caption").notNull().default(""),
  cta: text("cta").notNull().default(""),
  /** CarouselSpec for carousels and story sequences. */
  spec: jsonb("spec"),
  status: text("status", { enum: ["draft", "assembled"] }).notNull().default("draft"),
  clipMediaId: uuid("clip_media_id").references(() => media.id, { onDelete: "set null" }),
  outputMediaId: uuid("output_media_id").references(() => media.id, { onDelete: "set null" }),
  reelSeconds: numeric("reel_seconds", { precision: 6, scale: 2 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("drafts_user_idx").on(t.userId, t.createdAt)]);

/* A saved hook: the words alone, with no caption, for the Hooks page. Written
   by "Write hooks", "Add a hook" and "Save hook"; a reel or a set made from one
   stamps the matching `used_*` column. The same words twice for one avatar are
   refused by the database itself (the normalised-text unique index), so two
   quick taps cannot file a line twice. Reels keep their own drafts; this table
   is not what a reel is printed from. */
export const hooks = pgTable("hooks", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").notNull().references(() => avatars.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  usedReelAt: timestamp("used_reel_at", { withTimezone: true }),
  usedCarouselAt: timestamp("used_carousel_at", { withTimezone: true }),
  copiedAt: timestamp("copied_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("hooks_user_avatar_idx").on(t.userId, t.avatarId, t.createdAt),
  uniqueIndex("hooks_avatar_text_idx").on(t.avatarId, sql`lower(trim(${t.text}))`),
]);

/* Anything slower than a few seconds runs as a job: the request records it and
   returns, the client polls, and a poll advances the job (checks the provider,
   stores the output). No request ever waits on a video. */
export const jobs = pgTable("jobs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").references(() => avatars.id, { onDelete: "cascade" }),
  /* "agent" is a chat request carried out as a run of the other kinds: it costs nothing itself and its children pay their own way. */
  /* "text_photo" is her words drawn on one of her photos (free, canvas only). Both are TypeScript-only values: the column is plain text. */
  kind: text("kind", { enum: ["image", "clip", "reel", "carousel", "identity_view", "agent", "text_photo", "week"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  /** Client-generated id: a retried submission returns the existing job instead of starting another. */
  requestId: text("request_id").notNull(),
  provider: text("provider"),
  providerRequestId: text("provider_request_id"),
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  error: text("error"),
  credits: integer("credits").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("jobs_user_request_idx").on(t.userId, t.requestId),
  index("jobs_user_status_idx").on(t.userId, t.status),
  /* The agent chat's history: one account's runs of one kind, newest first,
     read straight off the index instead of sorting every job she has. */
  index("jobs_user_kind_created_idx").on(t.userId, t.kind, t.createdAt),
]);

/* Credits are an append-only ledger; the balance is the sum. A job reserves by
   writing a negative row and refunds with a positive one, so a crash can never
   lose or mint credits silently. */
export const creditLedger = pgTable("credit_ledger", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  /* "free_grant" is the one-time allowance every account starts with; "adjustment" is a grant by hand. */
  reason: text("reason", { enum: ["free_grant", "job_reserve", "job_refund", "adjustment"] }).notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("credit_ledger_user_idx").on(t.userId, t.createdAt)]);

/** What each generation cost us in dollars, for margin reporting. Separate from credits, which are what the user pays. */
export const providerCosts = pgTable("provider_costs", {
  id: id(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  kind: text("kind").notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull(),
  status: text("status", { enum: ["reserved", "done", "refunded"] }).notNull().default("reserved"),
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [index("provider_costs_user_idx").on(t.userId, t.createdAt)]);

/* Per-user rate limits, one row per (user, bucket, window).
 *
 * Every counter lives here rather than in memory because there is no "here":
 * a serverless function is many processes and none of them outlive a request.
 * The window start is the row's own identity, so a new window is a new row and
 * an old one is simply never read again; `expires_at` is what the sweep uses to
 * take them away. Counting is a single upsert whose UPDATE is conditional on
 * the count still being under the cap, so a hundred concurrent calls cannot all
 * read "under" and all write. */
export const rateLimits = pgTable("rate_limits", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The named limit, from src/lib/limits.ts. */
  bucket: text("bucket").notNull(),
  /** Start of the fixed window this row counts, floored to the window length. */
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  /** When this row stops meaning anything, so old rows can be swept. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.bucket, t.windowStart] }),
  index("rate_limits_expiry_idx").on(t.expiresAt),
]);

/* Every time a safety check refused something, for the operator.
 *
 * The image never goes in here and neither does the prompt: a refusal record
 * that holds the thing it refused is a copy of exactly the material we did not
 * want to keep. What is stored is who, what category, at which point, and when
 * — enough to see a pattern and act on it, and nothing more. */
export const safetyRefusals = pgTable("safety_refusals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Where the check ran: photo upload, or a generation about to start. */
  stage: text("stage", { enum: ["upload", "generation", "scene_idea"] }).notNull(),
  /** Why, as a category and never as a description of the image. */
  reason: text("reason", { enum: ["apparent_minor", "nudity", "sexual", "real_person", "check_failed"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("safety_refusals_user_idx").on(t.userId, t.createdAt)]);

/* One chat with the agent (Agent v2). `messages` is ThreadMessage[] and
   `offers` Offer[] from src/agent/v2/types.ts. Chats are not remembered across
   threads; what should outlive one goes to brand_memory. */
export const agentThreads = pgTable("agent_threads", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").notNull().references(() => avatars.id, { onDelete: "cascade" }),
  title: text("title"),
  messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
  /** Credits she said this thread may spend without asking again. */
  budgetCredits: integer("budget_credits").notNull().default(0),
  spentCredits: integer("spent_credits").notNull().default(0),
  offers: jsonb("offers").notNull().default(sql`'[]'::jsonb`),
  /** The last turn's client request id: a resent turn is answered once. */
  lastRequestId: text("last_request_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("agent_threads_user_avatar_idx").on(t.userId, t.avatarId, t.updatedAt)]);

/* Facts about her that the agent wrote down or she typed, shown and editable
   on the Brand page. Writers treat them as allowed ground, like her story. */
export const brandMemory = pgTable("brand_memory", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  avatarId: uuid("avatar_id").notNull().references(() => avatars.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  source: text("source", { enum: ["agent", "her"] }).notNull(),
  threadId: uuid("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("brand_memory_user_avatar_idx").on(t.userId, t.avatarId)]);

export const usersRelations = relations(users, ({ many }) => ({ avatars: many(avatars), media: many(media), drafts: many(drafts) }));
export const avatarsRelations = relations(avatars, ({ one, many }) => ({
  user: one(users, { fields: [avatars.userId], references: [users.id] }),
  references: many(avatarReferences),
}));
export const avatarReferencesRelations = relations(avatarReferences, ({ one }) => ({
  avatar: one(avatars, { fields: [avatarReferences.avatarId], references: [avatars.id] }),
  media: one(media, { fields: [avatarReferences.mediaId], references: [media.id] }),
}));
