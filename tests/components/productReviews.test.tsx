/**
 * Path: tests/components/productReviews.test.tsx
 * Purpose: The review list's summary, rating filter, empty and failure states, the paging it gains past a page and the form a signed-in customer writes through
 * Lines: 502
 */

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  A11Y_COPY,
  ACCOUNT_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  PAGE_SIZE_LABEL,
  PAGING_NOUNS,
  VALIDATION_MESSAGES,
  clearFacetLabel,
  pageAnnouncement,
  pagingCountLabel,
} from "@/constants/content";
import { loginPath, productPath } from "@/constants/routes";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import { PRODUCTS } from "@/data/products";
import { REVIEWS } from "@/data/reviews";
import { ProductReviews } from "@/features/catalog/ProductReviews";
import type { Product, RatingValue, Review } from "@/types/catalog";
import { formatReviewCount } from "@/utils/format";

import type { UserEvent } from "../testUtils";
import { failNext, renderApp, renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The review section seen from the outside: the count it announces, the rows and their verified-purchase
 * mark, the rating filter and the two empty states it can reach, the failure with its retry, the paging it
 * gains once a product holds more than a page of reviews, and the form a signed-in customer submits through.
 *
 * The list is mounted twice over: `renderWithProviders` mounts the section itself for the states a product
 * alone decides, and `renderApp` drives the real product route for the states a session decides — the form,
 * the empty state that focuses it, the paging a write moves and the submission a shopper abandons. Every
 * input comes from the seeded records or the copy module, so no figure and no sentence is typed here, and
 * the failure is armed at the seam through `failNext` rather than by standing in for a service.
 *
 * The seeding bounds what this file can reach: the catalogue's largest review collection is six rows and
 * `DEFAULT_PAGE_SIZE` is twelve, so the pager exists only after a signed-in customer has published enough
 * reviews to carry the list past one page — which is why the paging case writes them.
 */

// The subjects this file reads, taken from the seeded collection --------------------------------

/** The stars a review may carry, in the order the filter offers them. */
const RATING_STARS: readonly RatingValue[] = [5, 4, 3, 2, 1];

/** The facet the section's filter narrows, named by the id the vocabulary indexes facets by. */
const RATING_FACET_ID = "rating";

/** The rows the seeded collection holds for one product, newest first. */
function seededReviews(product: Product): readonly Review[] {
  return REVIEWS.filter((review) => review.productId === product.id);
}

/** The product the section's own states are read from: it carries rows, at least one of them the verified
 *  purchase the mark states, and it has not been given every star — so the filter has a rating that still
 *  matches and one that leaves nothing. */
function reviewedProduct(): Product {
  const found = PRODUCTS.find((product) => {
    const rows = seededReviews(product);
    const stars = new Set(rows.map((row) => row.rating));
    return rows.some((row) => row.verifiedPurchase) && stars.size < RATING_STARS.length;
  });
  if (found === undefined) {
    throw new Error("No seeded product carries a verified review and a missing star.");
  }
  return found;
}

/** The product the empty list is read from: one nobody has reviewed. */
function unreviewedProduct(): Product {
  const found = PRODUCTS.find((product) => seededReviews(product).length === 0);
  if (found === undefined) throw new Error("Every seeded product carries reviews.");
  return found;
}

/** The product the paging is read from: the one the seed wrote the most rows for. */
function mostReviewedProduct(): Product {
  const ranked = [...PRODUCTS].sort(
    (left, right) => seededReviews(right).length - seededReviews(left).length,
  );
  const found = ranked[0];
  if (found === undefined) throw new Error("The seeded catalogue holds no products.");
  return found;
}

/** The star the rows for a product carry most often, which is the one a filter still matches. */
function carriedStar(product: Product): RatingValue {
  const found = RATING_STARS.map((star) => ({
    star,
    count: seededReviews(product).filter((row) => row.rating === star).length,
  })).sort((left, right) => right.count - left.count)[0];
  if (found === undefined || found.count === 0) {
    throw new Error(`No star is carried by the rows for "${product.name}".`);
  }
  return found.star;
}

/** A star no row for a product carries, which is the one a filter leaves nothing under. */
function absentStar(product: Product): RatingValue {
  const carried = new Set(seededReviews(product).map((row) => row.rating));
  const found = RATING_STARS.find((star) => !carried.has(star));
  if (found === undefined) {
    throw new Error(`Every star is carried by the rows for "${product.name}".`);
  }
  return found;
}

const REVIEWED_PRODUCT = reviewedProduct();
const UNREVIEWED_PRODUCT = unreviewedProduct();
const PAGED_PRODUCT = mostReviewedProduct();
/** The wording of the filtered-empty state's one action, read from the vocabulary the section reads it
 *  from, so the control's name is the facet's own label and not a phrase written here. */
const CLEAR_RATING_FILTER_LABEL = clearFacetLabel(
  FACET_DEFINITIONS.find((definition) => definition.id === RATING_FACET_ID)?.label ??
    EMPTY_STATES.catalogue.actionLabel,
);

// The drafts a signed-in customer submits --------------------------------------------------------

/** The three controls of the review form, as the case fills them. */
interface ReviewDraftFields {
  readonly star: RatingValue;
  readonly title: string;
  readonly body: string;
}

/** A body the review rule accepts, whose length is inside the bound the form states. */
const DRAFT_BODY = "Written by this case: the list, its count and its paging all move with it.";

/** The star a case submits where the product carries no rows to read one from: the highest one, which the
 *  rating control offers like any other. */
const FIRST_REVIEW_STAR: RatingValue = RATING_STARS[0] ?? 5;

/** One numbered draft, so a case's writes are told apart in the list they land in. */
function draftFor(index: number, star: RatingValue): ReviewDraftFields {
  return { star, title: `Case review ${String(index + 1)} of the list`, body: DRAFT_BODY };
}

// Reading the rendered surface -------------------------------------------------------------------

/** The review section the page or the case is showing. */
function reviewSection(): HTMLElement {
  return screen.getByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
}

/** The review rows the section is listing, in the order it renders them. */
function reviewRows(): HTMLElement[] {
  return within(reviewSection()).queryAllByRole("listitem");
}

/** The count the section announces, read from the polite region its own summary row holds — the first of
 *  the section's regions in every state, the form's own notice standing below it. */
function announcedReviewCount(): string {
  const summary = within(reviewSection()).getAllByRole("status")[0];
  if (summary === undefined) throw new Error("The review section announced no count.");
  return summary.textContent ?? "";
}

/** The section's paging control, which is rendered only while the list holds more than one page. */
function reviewPager(): HTMLElement {
  return within(reviewSection()).getByRole("navigation", { name: A11Y_COPY.PAGINATION_LABEL });
}

/** The rating filter the section's summary holds. */
function ratingFilter(): HTMLElement {
  return within(reviewSection()).getByRole("combobox", {
    name: CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL,
  });
}

/** The form a signed-in customer writes in. */
function reviewForm(): HTMLElement {
  return screen.getByRole("form", { name: CATALOG_COPY.WRITE_REVIEW_LABEL });
}

/** Signs the demonstration shopper in from the page the case starts at, which is where the session
 *  returns them, and waits for the heading that page names the product with. */
async function signInShopper(user: UserEvent, product: Product): Promise<void> {
  await user.type(
    await screen.findByLabelText(ACCOUNT_COPY.EMAIL_LABEL, { exact: false }),
    DEMO_ACCOUNTS.CUSTOMER_EMAIL,
  );
  await user.type(
    screen.getByLabelText(ACCOUNT_COPY.PASSWORD_LABEL, { exact: false }),
    DEMO_ACCOUNTS.PASSWORD,
  );
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await screen.findByRole("heading", { level: 1, name: product.name });
}

/** Opens the product page's reviews tab and returns the section it reveals. */
async function openReviewsTab(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
  return screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
}

/** Fills the form's three controls through the interaction driver. */
async function fillReviewDraft(
  user: UserEvent,
  form: HTMLElement,
  draft: ReviewDraftFields,
): Promise<void> {
  await user.click(within(form).getByRole("radio", { name: String(draft.star) }));
  await user.type(within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_TITLE_LABEL), draft.title);
  await user.type(within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_BODY_LABEL), draft.body);
}

/** Submits the draft the form holds. */
async function submitReviewDraft(user: UserEvent, form: HTMLElement): Promise<void> {
  await user.click(
    within(form).getByRole("button", { name: CATALOG_COPY.REVIEW_FORM_SUBMIT_LABEL }),
  );
}

/** Publishes one numbered review and waits for the list to state the row it gained, so a case never reads
 *  the section while the write is still in flight. */
async function publishReview(
  user: UserEvent,
  draft: ReviewDraftFields,
  expectedRowCount: number,
): Promise<void> {
  await fillReviewDraft(user, reviewForm(), draft);
  await submitReviewDraft(user, reviewForm());
  await waitFor(() => expect(reviewRows()).toHaveLength(expectedRowCount));
}

// The list a visitor who is not signed in reads ---------------------------------------------------

describe("the review list a visitor reads", () => {
  it("lists the rows with their mark, announces their count and offers the rating filter", async () => {
    const rows = seededReviews(REVIEWED_PRODUCT);
    renderWithProviders(<ProductReviews className="sp-stack" productId={REVIEWED_PRODUCT.id} />, {
      route: productPath(REVIEWED_PRODUCT.slug),
    });

    const section = await screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });

    // The first page of the seeded collection: every row this product carries, which is fewer than the
    // default page size, with the mark stated for exactly the rows that carry it.
    expect(await within(section).findAllByRole("listitem")).toHaveLength(rows.length);
    expect(announcedReviewCount()).toContain(formatReviewCount(rows.length));
    for (const row of rows) expect(within(section).getByText(row.title)).toBeInTheDocument();
    const verified = rows.filter((row) => row.verifiedPurchase);
    expect(within(section).getAllByText(CATALOG_COPY.VERIFIED_PURCHASE_LABEL)).toHaveLength(
      verified.length,
    );
    expect(verified.length).toBeGreaterThan(0);

    // The filter offers the unfiltered choice beside every star, and a visitor with no session is offered
    // the session rather than the form.
    const filter = ratingFilter();
    expect(within(filter).getAllByRole("option")).toHaveLength(RATING_STARS.length + 1);
    expect(
      within(filter).getByRole("option", { name: CATALOG_COPY.ANY_RATING_LABEL }),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("form")).toBeNull();
    expect(within(section).getByText(FEEDBACK_COPY.SIGN_IN_REQUIRED)).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: CATALOG_COPY.SIGN_IN_TO_REVIEW_LABEL }),
    ).toHaveAttribute("href", loginPath(productPath(REVIEWED_PRODUCT.slug)));
  });

  it("offers the session instead of the form when the product has no reviews at all", async () => {
    renderWithProviders(<ProductReviews productId={UNREVIEWED_PRODUCT.id} />, {
      route: productPath(UNREVIEWED_PRODUCT.slug),
    });

    const section = await screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    expect(
      await within(section).findByRole("heading", { name: EMPTY_STATES.reviews.title }),
    ).toBeInTheDocument();
    expect(within(section).getByText(EMPTY_STATES.reviews.description)).toBeInTheDocument();
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(section).getByText(formatReviewCount(0))).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
      "href",
      loginPath(productPath(UNREVIEWED_PRODUCT.slug)),
    );
    expect(within(section).queryByRole("form")).toBeNull();
  });

  it("narrows the list to one rating and clears the narrowing when it matches nothing", async () => {
    const { user } = renderWithProviders(<ProductReviews productId={REVIEWED_PRODUCT.id} />, {
      route: productPath(REVIEWED_PRODUCT.slug),
    });
    const rows = seededReviews(REVIEWED_PRODUCT);
    const matching = carriedStar(REVIEWED_PRODUCT);
    const carried = rows.filter((row) => row.rating === matching).length;

    await screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    await waitFor(() => expect(reviewRows()).toHaveLength(rows.length));

    // One rating: the list and the announced count both narrow to the rows that carry it.
    await user.selectOptions(ratingFilter(), String(matching));
    await waitFor(() => expect(reviewRows()).toHaveLength(carried));
    expect(announcedReviewCount()).toContain(formatReviewCount(carried));

    // A rating nothing carries: the list says what the filter left rather than what the product lacks, and
    // the one control it offers clears that rating alone.
    await user.selectOptions(ratingFilter(), String(absentStar(REVIEWED_PRODUCT)));
    expect(
      await within(reviewSection()).findByRole("heading", { name: EMPTY_STATES.reviews.title }),
    ).toBeInTheDocument();
    expect(
      within(reviewSection()).getByText(EMPTY_STATES.catalogue.description),
    ).toBeInTheDocument();
    expect(within(reviewSection()).queryAllByRole("listitem")).toHaveLength(0);

    await user.click(
      within(reviewSection()).getByRole("button", { name: CLEAR_RATING_FILTER_LABEL }),
    );
    await waitFor(() => expect(reviewRows()).toHaveLength(rows.length));
    expect(ratingFilter()).toHaveValue("");

    // The filter's own unfiltered choice is a way back like any other, so a reader who narrowed the list can
    // clear it from the control rather than only from the empty state's action.
    await user.selectOptions(ratingFilter(), String(matching));
    await waitFor(() => expect(reviewRows()).toHaveLength(carried));
    await user.selectOptions(
      ratingFilter(),
      within(ratingFilter()).getByRole("option", { name: CATALOG_COPY.ANY_RATING_LABEL }),
    );
    await waitFor(() => expect(reviewRows()).toHaveLength(rows.length));
    expect(ratingFilter()).toHaveValue("");
  });

  it("states the seam's own message when the read fails, and re-reads the list on the retry", async () => {
    const { user } = renderWithProviders(<ProductReviews productId={REVIEWED_PRODUCT.id} />, {
      route: productPath(REVIEWED_PRODUCT.slug),
    });
    const rows = seededReviews(REVIEWED_PRODUCT);
    const refusal = failNext({ routeId: "reviews.list" });

    const section = await screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);

    // The failure is the seam's and it is one-shot, so the retry answers with the rows themselves.
    refusal.disarm();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    await waitFor(() => expect(reviewRows()).toHaveLength(rows.length));
    expect(within(section).queryByRole("alert")).toBeNull();
  });
});

// The form a signed-in customer writes through --------------------------------------------------

describe("the review form a signed-in customer writes through", () => {
  it("reports an incomplete draft in its fields and a refused write above them", async () => {
    const { user } = renderApp({ route: loginPath(productPath(REVIEWED_PRODUCT.slug)) });
    await signInShopper(user, REVIEWED_PRODUCT);
    await openReviewsTab(user);
    const form = reviewForm();

    // An empty draft is judged by the review rule, which names every field it is missing.
    await submitReviewDraft(user, form);
    expect(within(form).getAllByText(VALIDATION_MESSAGES.REQUIRED)).toHaveLength(3);
    expect(within(form).queryByRole("alert")).toBeNull();

    // A draft the rule accepts meets a refusal at the seam: the message the seam shaped is stated above
    // the fields, and the draft stands rather than being cleared by a write that published nothing.
    const draft = draftFor(0, carriedStar(REVIEWED_PRODUCT));
    await fillReviewDraft(user, form, draft);
    const refusal = failNext({ routeId: "reviews.create" });
    await submitReviewDraft(user, form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      FEEDBACK_COPY.ERROR_STATE_BODY,
    );
    expect(within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_TITLE_LABEL)).toHaveValue(
      draft.title,
    );
    refusal.disarm();
  });

  it("takes a shopper from the empty list to the form and confirms the review it publishes", async () => {
    const { user } = renderApp({ route: loginPath(productPath(UNREVIEWED_PRODUCT.slug)) });
    await signInShopper(user, UNREVIEWED_PRODUCT);
    await openReviewsTab(user);

    // A shopper who can write is not told to look for the form: the empty state's one control moves the
    // focus into it, which is where the draft below is written.
    await user.click(
      within(reviewSection()).getByRole("button", { name: EMPTY_STATES.reviews.actionLabel }),
    );
    expect(reviewForm()).toHaveFocus();

    await fillReviewDraft(user, reviewForm(), draftFor(0, FIRST_REVIEW_STAR));
    await submitReviewDraft(user, reviewForm());

    expect(await screen.findByText(FEEDBACK_COPY.TOAST_REVIEW_SUBMITTED)).toBeInTheDocument();
    await waitFor(() => expect(reviewRows()).toHaveLength(1));
    expect(announcedReviewCount()).toContain(formatReviewCount(1));
    expect(
      within(reviewSection()).queryByRole("heading", { name: EMPTY_STATES.reviews.title }),
    ).toBeNull();
  });

  it("writes one review when two submissions arrive in the same tick", async () => {
    const { user } = renderApp({ route: loginPath(productPath(REVIEWED_PRODUCT.slug)) });
    await signInShopper(user, REVIEWED_PRODUCT);
    await openReviewsTab(user);
    const seeded = seededReviews(REVIEWED_PRODUCT).length;
    const form = reviewForm();
    await fillReviewDraft(user, form, draftFor(0, carriedStar(REVIEWED_PRODUCT)));

    // A double press delivers two submissions before the first one's frame renders the control disabled —
    // the case of the guard the form holds, which is why the two are dispatched together rather than
    // through the driver, whose own clicks are separated by a render. One row is what a double press may
    // leave behind, however many submissions it starts.
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(await screen.findByText(FEEDBACK_COPY.TOAST_REVIEW_SUBMITTED)).toBeInTheDocument();
    await waitFor(() => expect(reviewRows()).toHaveLength(seeded + 1));
    expect(within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_TITLE_LABEL)).toHaveValue("");
  });

  it("pages the list once a product holds more than one page of reviews", async () => {
    const { user } = renderApp({ route: loginPath(productPath(PAGED_PRODUCT.slug)) });
    await signInShopper(user, PAGED_PRODUCT);
    await openReviewsTab(user);
    const seeded = seededReviews(PAGED_PRODUCT).length;
    const star = carriedStar(PAGED_PRODUCT);
    const largerPageSize = PAGE_SIZE_OPTIONS.find((size) => size > DEFAULT_PAGE_SIZE);
    if (largerPageSize === undefined)
      throw new Error("No page size larger than the default exists.");

    // A page holds what the default page size allows, so the seed's largest collection is filled to the
    // last row of page one before a write can carry the list past it.
    expect(
      within(reviewSection()).queryByRole("navigation", { name: A11Y_COPY.PAGINATION_LABEL }),
    ).toBeNull();
    const filling = DEFAULT_PAGE_SIZE - seeded;
    for (let index = 0; index < filling; index += 1) {
      await publishReview(user, draftFor(index, star), seeded + index + 1);
    }
    await publishReview(user, draftFor(filling, star), DEFAULT_PAGE_SIZE);

    const firstTotal = seeded + filling + 1;
    await waitFor(() =>
      expect(reviewPager()).toHaveTextContent(pagingCountLabel(firstTotal, PAGING_NOUNS.REVIEWS)),
    );
    expect(reviewPager()).toHaveTextContent(pageAnnouncement(1, 2));

    // The second page: the rows the first one left, and the page the control marks as the current one.
    await user.click(within(reviewPager()).getByRole("button", { name: "2" }));
    await waitFor(() => expect(reviewRows()).toHaveLength(firstTotal - DEFAULT_PAGE_SIZE));
    expect(reviewPager()).toHaveTextContent(pageAnnouncement(2, 2));

    // A published review leads the list, so the write made from the second page returns the reader to the
    // first one and states the row it added there.
    await publishReview(user, draftFor(filling + 1, star), DEFAULT_PAGE_SIZE);
    expect(reviewPager()).toHaveTextContent(pageAnnouncement(1, 2));

    // The size the reader chooses carries the whole list onto one page, and the pager leaves with it.
    await user.selectOptions(
      within(reviewPager()).getByRole("combobox", { name: PAGE_SIZE_LABEL }),
      String(largerPageSize),
    );
    await waitFor(() => expect(reviewRows()).toHaveLength(firstTotal + 1));
    expect(
      within(reviewSection()).queryByRole("navigation", { name: A11Y_COPY.PAGINATION_LABEL }),
    ).toBeNull();
  });

  it("drops the confirmation of a submission the shopper leaves before it lands", async () => {
    const { user } = renderApp({ route: loginPath(productPath(REVIEWED_PRODUCT.slug)) });
    await signInShopper(user, REVIEWED_PRODUCT);
    await openReviewsTab(user);
    const seeded = seededReviews(REVIEWED_PRODUCT).length;

    // The answer is held past the write so the tab change below lands while it is still in flight, which is
    // the one way a shopper can leave a submission of their own.
    vi.stubEnv("VITE_API_LATENCY_MS", "1000");
    try {
      await fillReviewDraft(user, reviewForm(), draftFor(0, carriedStar(REVIEWED_PRODUCT)));
      await submitReviewDraft(user, reviewForm());
      await user.click(screen.getByRole("tab", { name: CATALOG_COPY.DESCRIPTION_HEADING }));
    } finally {
      vi.stubEnv("VITE_API_LATENCY_MS", "0");
    }
    await screen.findByText(REVIEWED_PRODUCT.description);

    // The write was abandoned with the form: the list it belonged to holds the rows it held, and no
    // confirmation the shopper cannot see the subject of was raised anywhere.
    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    await waitFor(() => expect(reviewRows()).toHaveLength(seeded));
    expect(screen.queryByText(FEEDBACK_COPY.TOAST_REVIEW_SUBMITTED)).toBeNull();
  });
});
