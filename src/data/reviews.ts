/**
 * Path: src/data/reviews.ts
 * Purpose: The seeded reviews, and the product rating aggregates derived from them
 * Lines: 594
 */

import { BRAND_DEFINITIONS, CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import { CUSTOMERS } from "@/data/customers";
import { ORDERS } from "@/data/orders";
import { DATA_SEED, PRODUCTS, createSeededRandom, type SeededRandom } from "@/data/products";
import type { Customer } from "@/types/account";
import type { Product, RatingValue, Review } from "@/types/catalog";
import type {
  BrandId,
  CategoryId,
  CustomerId,
  IsoDateString,
  IsoDateTimeString,
  ProductId,
} from "@/types/common";
import { averageOf, clampNumber, groupBy, indexBy, sortByKey } from "@/utils/collections";
import {
  addDays,
  differenceInDays,
  parseIso,
  startOfDay,
  toIsoDate,
  toIsoDateTime,
} from "@/utils/dates";
import { roundToTenths } from "@/utils/statistics";
import { brandId, capitalise, categoryId, normaliseWhitespace, reviewId } from "@/utils/strings";

// Deterministic stream ---------------------------------------------------------------------------

/** This module's own stream, offset from the seed `src/data/products.ts` declares, so no seeded
 *  collection inherits another's draws and every one of them is reproducible on its own. */
const SEED = DATA_SEED + 3_003;

// The scale a review is written on, and the window it is dated in --------------------------------

/** The whole ratings a review may carry, smallest first: no rating outside this scale can be built. */
const RATING_SCALE: readonly RatingValue[] = [1, 2, 3, 4, 5];
/** The ends of the scale, read from it so neither can drift from the ratings above. */
const MIN_RATING = RATING_SCALE[0];
const MAX_RATING = RATING_SCALE[RATING_SCALE.length - 1];
/** The rating the complaining band ends at, the rating the mixed band occupies, and the tenths a
 *  one-decimal average is stated in — the scale `src/data/products.ts` writes a seeded average on. */
const NEGATIVE_RATING_MAX = 2;
const MIXED_RATING = 3;
const RATING_TENTHS = 10;
/** How far either side of a product's average its whole rating sum is searched for. */
const RATING_SEARCH_STEPS = RATING_SCALE.length;

/** The trailing window a review is dated inside, in days: a product's window is the shorter of this and
 *  the days since it was added. */
const REVIEW_SPAN_DAYS = 364;
/** The hours a review is written at, and the hour one takes on the day it shares with the product it reviews
 *  or the account that wrote it — above every hour `src/data/products.ts` dates a product at and
 *  `src/data/customers.ts` dates an account at, so a review never precedes either one. */
const REVIEW_FIRST_HOUR = 8;
const REVIEW_LAST_HOUR = 21;
const SAME_DAY_HOUR = 22;
/** The hour a review takes on the anchor day itself: the day's first hour, because every later hour of today
 *  may not have arrived yet, and the newest-first order must hold against a review just submitted. */
const ANCHOR_DAY_HOUR = 0;
/** The durations a review states, so the corpus says how long a product has been in use. */
const REVIEW_SPANS: readonly string[] = [
  "a few weeks",
  "one month",
  "three months",
  "six months",
  "a full winter",
  "eight months",
];

// The corpus's registers -------------------------------------------------------------------------

/** The three registers a review is written in, which its own rating decides. */
type ReviewBand = "negative" | "mixed" | "positive";

/** The band a rating falls in: one and two stars complain, three weighs both ways, four and five
 *  recommend. */
function bandOf(rating: RatingValue): ReviewBand {
  if (rating <= NEGATIVE_RATING_MAX) return "negative";
  return rating === MIXED_RATING ? "mixed" : "positive";
}

/** The headings each band's reviews are titled with; the `{brand}` token is filled per review. */
const REVIEW_TITLES: Readonly<Record<ReviewBand, readonly string[]>> = {
  negative: [
    "Not what I expected",
    "Short of the promise",
    "Wore out too soon",
    "Would not buy again",
    "Expected more for the money",
  ],
  mixed: [
    "Good, with two caveats",
    "Fine for the money",
    "Does the job",
    "Mixed feelings after a month",
    "Works, but nothing special",
  ],
  positive: [
    "Better than the listing suggested",
    "Does exactly what it says",
    "{brand} got this right",
    "Six months and still going",
    "No regrets",
    "The one I keep reaching for",
    "Holds up to daily use",
  ],
};

/** One sentence of a review body, with the tokens `fill` substitutes left in braces. Each band holds
 *  exactly `SENTENCES_PER_BAND` of them, because a body pairs two by rotation. */
const REVIEW_SENTENCES: Readonly<Record<ReviewBand, readonly string[]>> = {
  negative: [
    "{subject} is not what I expected and {value} falls well short of the listing.",
    "The {material} started to show wear within {span} and I stopped using it.",
    "It does nothing a cheaper one would not have done just as well.",
    "The photos flatter it: I had higher hopes for {detail}.",
    "I wanted to like it, but {value} made it hard to keep using.",
    "The second one arrived with the same fault as the first, so I gave up.",
    "For {category}, this is the wrong balance of price and finish.",
  ],
  mixed: [
    "{subject} is good, but {value} is not what the listing implies.",
    "It does the job, and it is not the one I would buy twice.",
    "Fine for the money, although the saving shows in {detail}.",
    "I like {subject}; I would not pay full price for it a second time.",
    "{product} is neither the best nor the worst of its kind.",
    "{span} later it still does what I need, with a small rattle I have learned to ignore.",
    "The {material} is the compromise: fine here, less so beside the one it replaced.",
  ],
  positive: [
    "I have had it {span} and {subject} has not slipped once.",
    "After {span} of use, I have no complaint about {detail}.",
    "I keep noticing {detail}, and it is why I would buy from {brand} again.",
    "What sold me was {value}, and it has held up to that promise.",
    "The {material} has taken daily use without marking or loosening.",
    "I bought it for {category} and it suits that better than the one it replaced.",
    "For the price, {value} alone would have been reason enough.",
  ],
};

/** The sentences each band holds; a body pairs two of them by rotation, so no product pairs one twice. */
const SENTENCES_PER_BAND = 7;
for (const sentences of Object.values(REVIEW_SENTENCES)) {
  if (sentences.length !== SENTENCES_PER_BAND) {
    throw new Error("A review band must hold exactly one sentence per rotation step.");
  }
}
/** How far along the pool a body's second sentence sits: one to three steps past the first, so the two
 *  never repeat. */
const SECOND_SENTENCE_STEPS = 3;

// What each category's reviews are about ---------------------------------------------------------

/** The aspect a category's reviews are written about: what a reviewer of this aisle discusses, the part
 *  of it they single out, and what they weigh against the price. */
interface CategoryVoice {
  readonly subject: string;
  readonly detail: string;
  readonly value: string;
}

/** A category definition that hangs under a parent, and therefore holds products. */
type LeafDefinition = Extract<(typeof CATEGORY_DEFINITIONS)[number], { parentSlug: string }>;
/** The slug of one of the twelve leaf categories the catalogue's products belong to. */
type LeafSlug = LeafDefinition["slug"];
/** The leaf categories, in the vocabulary's own order. */
const LEAF_DEFINITIONS: readonly LeafDefinition[] = CATEGORY_DEFINITIONS.filter(
  (entry): entry is LeafDefinition => entry.parentSlug !== null,
);

/** The twelve voices, one per leaf category: a review of a product in this aisle is about this, in these
 *  words, so 420 rows read as four hundred different pieces of writing rather than one repeated. */
const CATEGORY_VOICES: Readonly<Record<LeafSlug, CategoryVoice>> = {
  audio: { subject: "the sound", detail: "the mid-range", value: "how long a charge lasts" },
  cameras: {
    subject: "the autofocus",
    detail: "the grip and the dials",
    value: "what a usable frame costs",
  },
  laptops: {
    subject: "the keyboard",
    detail: "the hinge and the chassis",
    value: "a working day on one charge",
  },
  "phones-accessories": {
    subject: "the fit",
    detail: "the contact surface",
    value: "a second one for the same money",
  },
  cookware: {
    subject: "the heat across the base",
    detail: "the weight in one hand",
    value: "how it seasons over a year",
  },
  furniture: {
    subject: "how square it has stayed",
    detail: "the finish on the top",
    value: "what it costs against veneer",
  },
  fitness: {
    subject: "the grip",
    detail: "how small it stores",
    value: "what a rack of separate weights would cost",
  },
  camping: {
    subject: "the pack size",
    detail: "the seams and the proofing",
    value: "the weight it adds to a pack",
  },
  "mens-clothing": {
    subject: "the fit",
    detail: "the seams and the knit",
    value: "how it wears through a winter",
  },
  "womens-clothing": {
    subject: "the cut",
    detail: "the drape of the fabric",
    value: "how it holds up after a season",
  },
  "skin-care": {
    subject: "the texture",
    detail: "how it sits under a moisturiser",
    value: "how long a jar lasts",
  },
  "board-games": {
    subject: "the first game",
    detail: "how the board holds up",
    value: "how often it reaches the table",
  },
};

/** The voice a category outside the vocabulary is written in, and the material a product whose rows record
 *  none is written with. Neither is reachable from the seeded catalogue, so they only keep the corpus total. */
const GENERIC_VOICE: CategoryVoice = { subject: "it", detail: "the finish", value: "how it lasts" };
const GENERIC_MATERIAL = "material";
const MATERIAL_SPEC_LABEL = "Material";

/** The voice of every leaf category, keyed by the category identifier the catalogue's products carry. */
const VOICE_BY_CATEGORY: ReadonlyMap<CategoryId, CategoryVoice> = new Map(
  LEAF_DEFINITIONS.map((entry) => [categoryId(entry.slug), CATEGORY_VOICES[entry.slug]] as const),
);
/** The vocabulary's name for each category and brand, keyed by the identifier a product carries. */
const CATEGORY_NAME_BY_ID: ReadonlyMap<CategoryId, string> = new Map(
  CATEGORY_DEFINITIONS.map((entry) => [categoryId(entry.slug), entry.name] as const),
);
const BRAND_NAME_BY_ID: ReadonlyMap<BrandId, string> = new Map(
  BRAND_DEFINITIONS.map((entry) => [brandId(entry.slug), entry.name] as const),
);

// Verified purchases, read from the order history -------------------------------------------------

/** Every seeded account keyed by its identifier, so each order's attribution resolves. */
const CUSTOMER_BY_ID: ReadonlyMap<CustomerId, Customer> = indexBy(
  CUSTOMERS,
  (customer) => customer.id,
);

/**
 * The accounts whose own orders bought each product: the only source of a review's verified-purchase
 * flag, so the flag states what the seeded order history holds rather than a stylistic default. The
 * history attributes sixty orders to twenty-four of the forty accounts and leaves the rest to guests, so
 * most reviews are legitimately unverified and a handful of products have a buyer to draw on.
 */
function buyersByProduct(): ReadonlyMap<ProductId, readonly Customer[]> {
  const buyers = new Map<ProductId, Customer[]>();
  for (const order of ORDERS) {
    const customerId = order.customerId;
    if (customerId === null) continue;
    const customer = CUSTOMER_BY_ID.get(customerId);
    if (customer === undefined) continue;
    for (const line of order.lines) {
      const bought = buyers.get(line.productId);
      if (bought === undefined) buyers.set(line.productId, [customer]);
      else if (!bought.includes(customer)) bought.push(customer);
    }
  }
  return buyers;
}

/** The buyers of every product, built once. */
const BUYERS_BY_PRODUCT: ReadonlyMap<ProductId, readonly Customer[]> = buyersByProduct();

/** Whether an account's own orders hold a product: the verified-purchase flag, computed from the order
 *  history on every row rather than flagged true by default. */
function verifiedPurchaseFor(productId: ProductId, customerId: CustomerId): boolean {
  return (BUYERS_BY_PRODUCT.get(productId) ?? []).some((buyer) => buyer.id === customerId);
}

// The rating mix ---------------------------------------------------------------------------------

/** Confines a rating to the scale — the value is confined to the ratings the scale holds and then read
 *  off it by position — so a widened or reduced step can never leave the one-to-five range. */
function clampRating(value: number): RatingValue {
  return RATING_SCALE[clampNumber(Math.round(value), MIN_RATING, MAX_RATING) - MIN_RATING];
}

/**
 * The whole sum of ratings a product's rows carry, so their mean reproduces the one-decimal average the
 * catalogue seeds: that average is this sum over the row count, so a sum near it is searched for one whose
 * tenths are the seeded average's, compared as `src/data/products.ts` compares them.
 *
 * @param count - How many review rows the product holds.
 * @param average - The one-decimal average the catalogue seeds for it.
 * @returns The whole sum of that many integer ratings.
 * @throws Error - When no whole sum reproduces the average the catalogue seeds.
 */
function ratingTotalFor(count: number, average: number): number {
  const tenths = Math.round(average * RATING_TENTHS);
  const centre = Math.round(average * count);
  for (let step = 0; step <= RATING_SEARCH_STEPS; step += 1) {
    for (const candidate of [centre + step, centre - step]) {
      if (candidate < count * MIN_RATING || candidate > count * MAX_RATING) continue;
      if (Math.round((candidate / count) * RATING_TENTHS) === tenths) return candidate;
    }
  }
  throw new Error(`No whole rating sum reproduces an average of ${average} over ${count} reviews.`);
}

/** The last row that may take a point in a widening move: one rated at or above the rounded-down share
 *  and below the top of the scale, or `-1` when no row can. */
function lastIndexAbove(ratings: readonly RatingValue[], share: number): number {
  for (let index = ratings.length - 1; index >= 0; index -= 1) {
    if (ratings[index] >= share && ratings[index] < MAX_RATING) return index;
  }
  return -1;
}

/**
 * The ratings a product's rows carry, in the order the rows are written: `ratingTotalFor`'s sum is spread
 * over the rows, then widened a few times by moving a point from a row at the rounded-down share to a row
 * above it — which leaves the sum, and so the mean, untouched — and the widened mix is shuffled.
 *
 * @param product - The product whose seeded rating pair the mix reproduces.
 * @param rand - The stream the widening and the shuffle are drawn from.
 * @returns One rating per review row.
 */
function buildRatingMix(product: Product, rand: SeededRandom): readonly RatingValue[] {
  const count = product.ratingCount;
  const total = ratingTotalFor(count, product.ratingAverage);
  const share = Math.floor(total / count);
  const raised = total - share * count;
  const ratings = Array.from({ length: count }, (_item, position) =>
    clampRating(position < raised ? share + 1 : share),
  );
  const moves = rand.int(0, Math.floor(count / 2));
  for (let move = 0; move < moves; move += 1) {
    const donor = ratings.findIndex((rating) => rating > MIN_RATING && rating <= share);
    const receiver = lastIndexAbove(ratings, share);
    if (donor < 0 || receiver < 0 || donor === receiver) break;
    ratings[donor] = clampRating(ratings[donor] - 1);
    ratings[receiver] = clampRating(ratings[receiver] + 1);
  }
  return rand.shuffle(ratings);
}

// The corpus -------------------------------------------------------------------------------------

/** Everything a review's sentences are filled with; its members are exactly the tokens the moulds use. */
interface ReviewContext {
  readonly product: string;
  readonly brand: string;
  readonly category: string;
  readonly material: string;
  readonly subject: string;
  readonly detail: string;
  readonly value: string;
  readonly span: string;
}

/** Substitutes a mould's `{token}` placeholders from the context, leaving an unknown token as it stands
 *  rather than rendering a gap into the sentence. */
function fill(mould: string, context: ReviewContext): string {
  return mould.replace(
    /\{(\w+)\}/gu,
    (placeholder, token: string) => context[token as keyof ReviewContext] ?? placeholder,
  );
}

/** The context one product's reviews are written in: its category's voice, the vocabulary's names for
 *  its brand and category, the material its own specification rows record, and this review's duration. */
function contextFor(product: Product, rand: SeededRandom): ReviewContext {
  const voice = VOICE_BY_CATEGORY.get(product.categoryId) ?? GENERIC_VOICE;
  const material = product.specs.find((spec) => spec.label === MATERIAL_SPEC_LABEL);
  return {
    product: product.name,
    brand: BRAND_NAME_BY_ID.get(product.brandId) ?? product.name,
    category: (CATEGORY_NAME_BY_ID.get(product.categoryId) ?? "the catalogue").toLowerCase(),
    material: material?.value ?? GENERIC_MATERIAL,
    subject: voice.subject,
    detail: voice.detail,
    value: voice.value,
    span: rand.pick(REVIEW_SPANS),
  };
}

/** The helpful votes each band's reviews attract: complaints are read and voted for, praise is skimmed. */
const HELPFUL_BY_BAND: Readonly<Record<ReviewBand, readonly [low: number, high: number]>> = {
  negative: [3, 24],
  mixed: [1, 16],
  positive: [0, 21],
};

/** How many readers found one review helpful, drawn from its band's range. */
function helpfulCountFor(band: ReviewBand, rand: SeededRandom): number {
  const [low, high] = HELPFUL_BY_BAND[band];
  return rand.int(low, high);
}

/** The name a review is signed with: the account's two name parts joined and single-spaced. Composed through
 *  the `normaliseWhitespace` rule `displayName` applies, rather than imported, because this data module must
 *  not depend on the transport module `src/lib/customerService.ts` pulls in. */
function reviewerName(customer: Customer): string {
  return normaliseWhitespace(`${customer.firstName} ${customer.lastName}`);
}

/**
 * The accounts that wrote a product's reviews: as many distinct ones as the product has rows, drawn from
 * its buyers for as many of those as the order history holds — at most one row each, which is what keeps
 * the identifiers keyed by product and account distinct — and from the accounts that never bought it for
 * the rest. The draw is shuffled, so a verified row is not always the first.
 *
 * @param product - The product being reviewed.
 * @param count - How many rows the product holds.
 * @param rand - The stream the draws are taken from.
 * @returns One distinct account per row.
 */
function authorsFor(product: Product, count: number, rand: SeededRandom): readonly Customer[] {
  const buyers = BUYERS_BY_PRODUCT.get(product.id) ?? [];
  const verified = Math.min(buyers.length, rand.int(0, count));
  const others = CUSTOMERS.filter((customer) => !buyers.some((buyer) => buyer.id === customer.id));
  const authors = [...rand.pickMany(buyers, verified), ...rand.pickMany(others, count - verified)];
  return rand.shuffle(authors);
}

/** How many days ago a product was added, measured from today and never negative. */
function productAgeDays(product: Product, anchorDay: IsoDateString): number {
  return Math.max(0, differenceInDays(startOfDay(product.createdAt), anchorDay));
}

/** How many days ago the account that wrote a review was created, measured from today and never negative:
 *  the oldest a row it wrote can be dated, because an account cannot review a product before it exists. */
function accountAgeDays(author: Customer, anchorDay: IsoDateString): number {
  return Math.max(0, differenceInDays(startOfDay(author.createdAt), anchorDay));
}

/**
 * The days before today a product's rows are dated at, newest first: drawn from the window the product can
 * be reviewed in — the trailing `REVIEW_SPAN_DAYS`, or the days since it was added when that is shorter —
 * so no review precedes the product it reviews and none falls outside the trailing year. The window is the
 * product's alone; `reviewsFor` narrows each offset to the age of the account that wrote the row.
 */
function reviewOffsets(age: number, count: number, rand: SeededRandom): readonly number[] {
  const span = Math.min(REVIEW_SPAN_DAYS, age);
  const offsets = Array.from({ length: count }, () => rand.int(0, span));
  return offsets.sort((left, right) => left - right);
}

/** The instant one review is written at: a day of its window, an hour inside the day and a minute inside
 *  the hour, built through `src/utils/dates.ts` as every other seeded timestamp is. A review dated on the
 *  day of its product or of its author's account takes `SAME_DAY_HOUR`, later than any hour either of those
 *  is dated at, so a row that lands on that day still follows it. A row that lands on the anchor day itself
 *  takes `ANCHOR_DAY_HOUR` instead, because the hours of today that have not arrived yet would date it after
 *  the moment it is read. The hour is still drawn exactly as it was, so the seed stream and every value it
 *  goes on to produce are unchanged. */
function reviewInstant(
  anchorDay: IsoDateString,
  offset: number,
  sameDay: boolean,
  rand: SeededRandom,
): IsoDateTimeString {
  const at = parseIso(addDays(anchorDay, -offset));
  if (at === null) throw new TypeError(`A review needs an ISO 8601 day; received "${anchorDay}".`);
  const drawn = sameDay ? SAME_DAY_HOUR : rand.int(REVIEW_FIRST_HOUR, REVIEW_LAST_HOUR);
  const hour = offset === 0 ? ANCHOR_DAY_HOUR : drawn;
  at.setHours(hour, rand.int(0, 59), 0, 0);
  return toIsoDateTime(at);
}

/**
 * The reviews of one product: as many rows as its seeded rating count, each carrying an integer rating from
 * the mix, an account of its own, a title and a two-sentence body in its band's register and its category's
 * voice, a timestamp inside the review window and no earlier than the account that wrote the row — an
 * account cannot review a product before it exists — and the helpful votes its band attracts, newest first.
 * Every offset `reviewOffsets` draws is clamped to the author's own age, which only ever moves a row later,
 * so the product-age bound and the window hold as they did.
 *
 * @param product - The product being reviewed.
 * @param anchorDay - Today, the end of the window the rows are dated in.
 * @param rand - This build's stream.
 * @returns The product's reviews, newest first; empty for a product the catalogue seeds no rating for.
 */
function reviewsFor(
  product: Product,
  anchorDay: IsoDateString,
  rand: SeededRandom,
): readonly Review[] {
  const count = product.ratingCount;
  if (count === 0) return [];
  const age = productAgeDays(product, anchorDay);
  const ratings = buildRatingMix(product, rand);
  const authors = authorsFor(product, count, rand);
  const offsets = reviewOffsets(age, count, rand);
  const context = contextFor(product, rand);
  const salt = rand.int(0, SENTENCES_PER_BAND - 1);
  const rows = ratings.map((rating, position) => {
    const band = bandOf(rating);
    const author = authors[position];
    // The clamp only pulls an offset later, so the product-age bound and the window still hold.
    const authorAge = accountAgeDays(author, anchorDay);
    const offset = Math.min(offsets[position], authorAge);
    const sameDay = offsets[position] === age || offset === authorAge;
    const sentences = REVIEW_SENTENCES[band];
    const step = 1 + (position % SECOND_SENTENCE_STEPS);
    const first = (salt + position) % SENTENCES_PER_BAND;
    const opening = capitalise(fill(sentences[first], context));
    const closing = capitalise(fill(sentences[(first + step) % SENTENCES_PER_BAND], context));
    const body = `${opening} ${closing}`;
    return {
      id: reviewId(`${product.id} ${author.id}`),
      productId: product.id,
      customerId: author.id,
      customerName: reviewerName(author),
      rating,
      title: fill(rand.pick(REVIEW_TITLES[band]), context),
      body,
      createdAt: reviewInstant(anchorDay, offset, sameDay, rand),
      helpfulCount: helpfulCountFor(band, rand),
      verifiedPurchase: verifiedPurchaseFor(product.id, author.id),
    };
  });
  return sortByKey(rows, (review) => review.createdAt, "desc");
}

/**
 * Builds the seeded reviews in one deterministic pass: every product's rows in catalogue order, each
 * product's newest first.
 *
 * Pure and re-callable: one seed stream and one reading of the clock reduced to a day, so two calls on the
 * same day return deeply equal collections — the determinism `tests/unit/lib/mockServer.test.ts` measures.
 *
 * @returns Every seeded review: `sum(ratingCount)` rows, which the catalogue's cycle makes 420.
 */
export function buildReviews(): readonly Review[] {
  const rand = createSeededRandom(SEED);
  const anchorDay = toIsoDate(new Date());
  const reviews: Review[] = [];
  for (const product of PRODUCTS) reviews.push(...reviewsFor(product, anchorDay, rand));
  return reviews;
}

/** The seeded reviews, exactly as `buildReviews` builds them: the collection `src/data/repositories.ts`
 *  serves for `GET /api/products/:id/reviews`, paged, newest first and optionally narrowed to one
 *  rating. */
export const REVIEWS: readonly Review[] = buildReviews();

/** What a product's reviews say about it: the mean of their ratings, to one decimal as the catalogue
 *  states it, and how many rows it was read from. */
export interface ProductRatingAggregate {
  readonly ratingAverage: number;
  readonly ratingCount: number;
}

/**
 * Derives each reviewed product's rating figures from its own rows, so the aggregate is a reading of the
 * reviews rather than a second statement of the catalogue's numbers, and the mean is `collections.ts`'s.
 *
 * @param reviews - The rows to aggregate; never mutated.
 * @returns One aggregate per product that holds rows, and no entry for a product that holds none.
 */
function buildRatingSummary(
  reviews: readonly Review[],
): Readonly<Record<ProductId, ProductRatingAggregate>> {
  const summary: Record<ProductId, ProductRatingAggregate> = {};
  for (const [productId, rows] of groupBy(reviews, (review) => review.productId)) {
    summary[productId] = {
      ratingAverage: roundToTenths(averageOf(rows.map((row) => row.rating))),
      ratingCount: rows.length,
    };
  }
  return summary;
}

/** The rating figures the seeded reviews imply, per product: what `src/data/repositories.ts` overlays on each
 *  product it serves, so the rating a tile shows and the one its detail page shows are the reviews' own. A
 *  product the catalogue seeds a count of zero for holds no row and so has no entry here, which is how the
 *  detail page's empty review state and the rating-filtered empty result stay reachable. */
export const PRODUCT_RATING_SUMMARY: Readonly<Record<ProductId, ProductRatingAggregate>> =
  buildRatingSummary(REVIEWS);
