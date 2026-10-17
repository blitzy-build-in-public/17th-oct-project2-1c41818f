/**
 * Path: src/features/catalog/ProductReviews.tsx
 * Purpose: The review list with rating filter and paging, and the review form for a signed-in customer
 * Lines: 565
 */

import { useCallback, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement, RefObject } from "react";

import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input, TextArea } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { Rating, RatingInput } from "@/components/ui/Rating";
import { Select } from "@/components/ui/Select";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  reviewBodyLengthMessage,
  reviewTitleLengthMessage,
} from "@/constants/content";
import { loginPath } from "@/constants/routes";
import { API_PATHS, fillApiPath, getJson, postJson } from "@/lib/apiClient";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { useAsync, usePagination } from "@/state/hooks";
import type { RatingValue, Review, ReviewInput, ReviewQuery } from "@/types/catalog";
import type {
  FieldErrors,
  PageResult,
  ProductId,
  Result,
  SelectOption,
  SessionToken,
} from "@/types/common";
import { formatDate } from "@/utils/dates";
import { formatReviewCount } from "@/utils/format";
import {
  FORM_ERROR_KEY,
  REVIEW_LIMITS,
  clearFieldError,
  fieldErrorsFromApiError,
  hasErrors,
  isRatingValue,
  mergeErrors,
  validateReview,
  validateReviewBody,
  validateReviewTitle,
} from "@/utils/validation";
import type { ReviewDraft } from "@/utils/validation";

/*
 * Plan gap, recorded so the next reader does not take it for an oversight: §0.6.3 declares `GET` and
 * `POST /api/products/:id/reviews`, but §0.6.1 gives neither to a service — `src/lib/catalogService.ts` holds
 * `listProducts`, `getProduct`, `getRelated`, `buildFacets` and `compareBy` alone. Both endpoints are
 * therefore reached through `src/lib/apiClient.ts`, the plan's one transport seam, using the path vocabulary
 * that module re-exports, so no request path is written twice.
 *
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class is consumed by name. `src/styles/catalog-detail.css`, which `src/styles/catalog.css` loads with
 * `@import`, declares `sp-reviews`, its `__summary` row, its `__list` and `__item`, the
 * `__header`/`__author`/`__date` byline, the `__title` h3, the `__body` prose measure and the `__form` grid;
 * `src/styles/controls.css` owns `sp-form` and `sp-form__actions`, and the feedback primitives own theirs. The
 * summary's count borrows `__date`, the family's caption treatment, because the sheet declares no rule of its
 * own for it and body type would outweigh the filter control beside it.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` holds no wording for three things this surface needs
 * — the rating filter's unfiltered choice, the mark a review carries when its reviewer bought the product, and
 * the outcome the submit reports — so the three labels below are held here until a plan amendment adds
 * `CATALOG_COPY.ANY_RATING_LABEL`, `CATALOG_COPY.VERIFIED_PURCHASE_LABEL` and
 * `FEEDBACK_COPY.TOAST_REVIEW_SUBMITTED` to it. Every other string is that module's own, the empty state's
 * included; the filter's five choices are the bare numerals, as the pagination control's size selector is,
 * because it holds no wording for a rating either.
 */

/** The rating filter's unfiltered choice — see the copy gap above. */
const ANY_RATING_LABEL = "All ratings";

/** The mark on a review whose reviewer's order history held the product — see the copy gap above. */
const VERIFIED_PURCHASE_LABEL = "Verified purchase";

/** What the toast reports once a review has been published — see the copy gap above. */
const REVIEW_SUBMITTED_MESSAGE = "Your review is published.";

/** The field keys the review rule reports under, which are also the `name` each control carries, so a map
 *  keyed by a field lands on the control that owns it. */
const REVIEW_FIELDS = { RATING: "rating", TITLE: "title", BODY: "body" } as const;

/** The filter's choices: every star, then the unfiltered one, so a cleared filter is a choice a reader can
 *  make rather than one only the empty state can restore. */
const RATING_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: "", label: ANY_RATING_LABEL },
  ...[5, 4, 3, 2, 1].map((star) => ({ value: String(star), label: String(star) })),
];

/** The form as it opens: no star chosen, both fields empty. */
const EMPTY_REVIEW_DRAFT: ReviewDraft = { rating: undefined, title: "", body: "" };

/** The placeholder rows the loading list stands in with, each carrying its own identity rather than a
 *  position, so no key is an index. */
const PLACEHOLDER_ROW_KEYS = ["first", "second", "third"] as const;

/**
 * Reads one page of a product's reviews: newest first, optionally narrowed to the single rating the filter
 * holds, as `GET /api/products/:id/reviews` answers it (§0.6.3). It needs no session, and a failure resolves
 * as a value for the caller to render.
 *
 * @param productId - The product whose reviews are wanted.
 * @param query - The page, its size and the rating to narrow to.
 * @param signal - The abort signal of the read a newer one supersedes.
 * @returns One page of reviews, or the shaped failure; never a rejection.
 */
function readReviews(
  productId: ProductId,
  query: ReviewQuery,
  signal: AbortSignal,
): Promise<Result<PageResult<Review>>> {
  return getJson<PageResult<Review>>(fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: productId }), {
    query: { page: query.page, pageSize: query.pageSize, rating: query.rating },
    signal,
  });
}

/**
 * Publishes a review and answers with the row the data layer stored, which is what the list is refreshed from
 * rather than a row assembled here.
 *
 * `POST /api/products/:id/reviews` (§0.6.3) requires a customer's session — an anonymous request answers
 * `401` — and re-runs the review rule over the body, answering `422` with the offending `field` named. The
 * author, the timestamp, the helpful count and the verified-purchase flag are the data layer's answer, so
 * none of them is sent from here.
 *
 * @param productId - The product being reviewed.
 * @param input - The rating, title and body the customer submitted.
 * @param sessionToken - The token the write authenticates with.
 * @returns The stored review, or the shaped failure; never a rejection.
 */
function writeReview(
  productId: ProductId,
  input: ReviewInput,
  sessionToken: SessionToken,
): Promise<Result<Review>> {
  return postJson<Review, ReviewInput>(
    fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: productId }),
    input,
    { sessionToken },
  );
}

/** The loading state: three decorative rows shaped like the reviews that will replace them, hidden from
 *  assistive technology because the section carries `aria-busy` while the read is in flight. */
function ReviewPlaceholders(): ReactElement {
  return (
    <div className="sp-reviews__list" aria-hidden="true">
      {PLACEHOLDER_ROW_KEYS.map((key) => (
        <Skeleton key={key} variant="row" />
      ))}
    </div>
  );
}

/**
 * One review: the rating it gives with its value as text, the reviewer, the day it was written, the
 * verified-purchase mark when the reviewer bought the product, and the review itself.
 *
 * Nothing is derived here: the rating is drawn by the shared control, which states the value as text so it is
 * not carried by the stars alone, the timestamp is formatted by `src/utils/dates.ts`, and the verified mark
 * is a badge, which says what it means in words rather than in a colour.
 *
 * @param props - The review to render.
 * @returns The list item holding it.
 */
function ReviewRow({ review }: { readonly review: Review }): ReactElement {
  return (
    <li className="sp-reviews__item">
      <div className="sp-reviews__header">
        <Rating value={review.rating} showValue />
        <span className="sp-reviews__author">{review.customerName}</span>
        <span className="sp-reviews__date">{formatDate(review.createdAt)}</span>
        {review.verifiedPurchase ? <Badge size="sm">{VERIFIED_PURCHASE_LABEL}</Badge> : null}
      </div>
      <h3 className="sp-reviews__title">{review.title}</h3>
      <p className="sp-reviews__body">{review.body}</p>
    </li>
  );
}

/**
 * What stands where the form would be for a visitor who is not signed in: the sentence saying a session is
 * needed and the one control that leads to one.
 *
 * The control is the navigation an action of this kind has to be — a link wearing the button family's classes
 * rather than a button that navigates — and its destination is composed by `src/constants/routes.ts`, so no
 * route string is written here and the page is returned to once the visitor has signed in.
 *
 * @param props - The sign-in destination.
 * @returns The prompt block.
 */
function SignInPrompt({ signInTo }: { readonly signInTo: string }): ReactElement {
  return (
    <div className="sp-reviews__form">
      <p className="sp-reviews__body">{FEEDBACK_COPY.SIGN_IN_REQUIRED}</p>
      <div className="sp-form__actions">
        <Link className="sp-btn sp-btn--secondary" to={signInTo}>
          {CATALOG_COPY.SIGN_IN_TO_REVIEW_LABEL}
        </Link>
      </div>
    </div>
  );
}

/** Everything {@link ReviewForm} accepts. */
interface ReviewFormProps {
  /** The product the review is written about, which the write names in its path. */
  readonly productId: ProductId;
  /** The token the write authenticates with, taken from the session in force. */
  readonly sessionToken: SessionToken;
  /** The form element, which the empty state's action focuses when there is nothing to review yet. */
  readonly formRef: RefObject<HTMLFormElement | null>;
  /** What a published review reports to the surface above, which refreshes the list it shows. */
  readonly onSubmitted: () => void;
}

/**
 * The form a signed-in customer writes a review in: a star rating, a title and the review itself.
 *
 * Three rules hold here. The review rule is `validateReview`'s and nowhere else: the draft is a `ReviewDraft`
 * — a rating possibly unchosen — and every message shown comes from that rule, whether it was reached on
 * submit or by the seam re-running it over the body, because the map the seam answers with is keyed by the
 * same fields the controls are named. A field's message clears the moment the field is edited and is
 * recomputed when it loses focus, so a reader is never told about a field they have already corrected. And a
 * submission is single: the flag below disables the control while the write is in flight, and a ref blocks
 * the second submission a double click could start before that flag has rendered, so one review is published
 * once.
 *
 * @param props - The product, the token, the form's own ref and the sink a published review reports to.
 * @returns The labelled form, with the review body's controls inside it.
 */
function ReviewForm({
  productId,
  sessionToken,
  formRef,
  onSubmitted,
}: ReviewFormProps): ReactElement {
  const toasts = useToast();
  const headingId = useId();
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_REVIEW_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Set before the request is issued, so a second submission arriving in the same tick is refused. */
  const submittingRef = useRef(false);

  const clearField = (field: string): void => {
    setFieldErrors((current) => clearFieldError(current, field));
  };

  const handleRatingChange = (rating: RatingValue): void => {
    setDraft((current) => ({ ...current, rating }));
    clearField(REVIEW_FIELDS.RATING);
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft((current) => ({ ...current, title: event.target.value }));
    clearField(REVIEW_FIELDS.TITLE);
  };

  const handleBodyChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft((current) => ({ ...current, body: event.target.value }));
    clearField(REVIEW_FIELDS.BODY);
  };

  /** Re-checks one field against the shared rule, leaving every other field's message as it stands. */
  const recheckField = (field: string, errors: FieldErrors): void => {
    setFieldErrors((current) => mergeErrors(clearFieldError(current, field), errors));
  };

  const submitReview = async (input: ReviewInput): Promise<void> => {
    const result = await writeReview(productId, input, sessionToken);
    submittingRef.current = false;
    setIsSubmitting(false);
    if (!result.ok) {
      // One map for both halves of a failure: a `422` naming a field marks that control, and a failure naming
      // none renders the alert above them, so no second error shape is declared here.
      setFieldErrors(fieldErrorsFromApiError(result.error));
      return;
    }
    setDraft(EMPTY_REVIEW_DRAFT);
    setFieldErrors({});
    toasts.success(REVIEW_SUBMITTED_MESSAGE);
    onSubmitted();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submittingRef.current) return;
    const errors = validateReview(draft);
    if (hasErrors(errors)) {
      setFieldErrors(errors);
      return;
    }
    const rating = draft.rating;
    // The rule above reports an unchosen star as missing, so this is unreachable from the form; it is what
    // keeps the submitted body total rather than making the rating optional downstream.
    if (!isRatingValue(rating)) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    void submitReview({ rating, title: draft.title.trim(), body: draft.body.trim() });
  };

  return (
    <form
      ref={formRef}
      className="sp-reviews__form sp-form"
      aria-labelledby={headingId}
      tabIndex={-1}
      noValidate
      onSubmit={handleSubmit}
    >
      <h3 id={headingId}>{CATALOG_COPY.WRITE_REVIEW_LABEL}</h3>
      {fieldErrors[FORM_ERROR_KEY] === undefined ? null : (
        <Alert tone="danger">{fieldErrors[FORM_ERROR_KEY]}</Alert>
      )}
      <RatingInput
        label={CATALOG_COPY.REVIEW_FORM_RATING_LABEL}
        value={draft.rating ?? null}
        onChange={handleRatingChange}
        error={fieldErrors[REVIEW_FIELDS.RATING]}
        isDisabled={isSubmitting}
      />
      <Input
        name={REVIEW_FIELDS.TITLE}
        label={CATALOG_COPY.REVIEW_FORM_TITLE_LABEL}
        hint={reviewTitleLengthMessage(REVIEW_LIMITS.TITLE_MIN, REVIEW_LIMITS.TITLE_MAX)}
        errors={fieldErrors}
        value={draft.title}
        maxLength={REVIEW_LIMITS.TITLE_MAX}
        onChange={handleTitleChange}
        onBlur={(): void => recheckField(REVIEW_FIELDS.TITLE, validateReviewTitle(draft.title))}
        isDisabled={isSubmitting}
      />
      <TextArea
        name={REVIEW_FIELDS.BODY}
        label={CATALOG_COPY.REVIEW_FORM_BODY_LABEL}
        hint={reviewBodyLengthMessage(REVIEW_LIMITS.BODY_MIN, REVIEW_LIMITS.BODY_MAX)}
        errors={fieldErrors}
        value={draft.body}
        rows={6}
        maxLength={REVIEW_LIMITS.BODY_MAX}
        showCount
        onChange={handleBodyChange}
        onBlur={(): void => recheckField(REVIEW_FIELDS.BODY, validateReviewBody(draft.body))}
        isDisabled={isSubmitting}
      />
      <div className="sp-form__actions">
        <Button type="submit" isLoading={isSubmitting}>
          {CATALOG_COPY.REVIEW_FORM_SUBMIT_LABEL}
        </Button>
      </div>
    </form>
  );
}

/** Everything {@link ProductReviews} accepts. */
export interface ProductReviewsProps {
  /** The product whose reviews are listed and written to, as the detail route read it from the path. */
  readonly productId: ProductId;
  /** Extra classes for the section's own box, for the page's layout. */
  readonly className?: string;
}

/**
 * A product's reviews: what other customers wrote, narrowed by the rating filter and cut to a page, with the
 * form a signed-in customer submits through.
 *
 * The read belongs to this file and there is exactly one of it. The rating filter and the page are state of
 * this section rather than of the URL, because the URL's filter state is the catalogue's — the search params
 * `src/utils/queryParams.ts` reads and writes carry the catalogue's query, and a product's reviews are a
 * section of a page rather than a listing of their own. Changing either one re-issues the read through
 * `useAsync`, which aborts the read it supersedes, so a slow page cannot overwrite the state of the one that
 * replaced it.
 *
 * Paging is the shared control's, reached through `usePagination`, so the page count, the two bounds and the
 * page buttons cannot disagree with the payload the endpoint answered. The read itself is issued with the page
 * the reader asked for rather than with the clamped one: while a page is in flight the previous total is not
 * in hand, and clamping against an absent total would re-issue the first page instead of the chosen one.
 *
 * All four states are derived during render — the placeholder rows while the read is in flight, the alert
 * carrying the failure's own message with its retry, the empty state when the product has no reviews at all or
 * when the chosen rating matches none of them, and the list otherwise — so nothing is mirrored into state and
 * no placeholder is ever shown beside a stale list. The summary's count is an always-present polite live
 * region, so a count changed by a filter is announced rather than only seen.
 *
 * @param props - The product to read reviews of, and the section's extra classes.
 * @returns The labelled section holding the summary, the reviews and the form.
 */
export function ProductReviews({ productId, className }: ProductReviewsProps): ReactElement {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const headingId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);

  const [ratingFilter, setRatingFilter] = useState<RatingValue | null>(null);
  const [paging, setPaging] = useState<{ readonly page: number; readonly pageSize: number }>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const reviews = useAsync<PageResult<Review>>(
    (signal) =>
      readReviews(
        productId,
        { page: paging.page, pageSize: paging.pageSize, rating: ratingFilter ?? undefined },
        signal,
      ),
    [productId, paging.page, paging.pageSize, ratingFilter],
  );

  const applyPaging = useCallback((page: number, pageSize: number): void => {
    setPaging({ page, pageSize });
  }, []);

  /** The paging the control renders, derived from the page asked for and the total of the page in hand. */
  const pager = usePagination({
    page: paging.page,
    pageSize: paging.pageSize,
    total: reviews.data?.total ?? 0,
    onChange: applyPaging,
  });

  /** Back to the first page, which a changed filter and a published review both need. */
  const goToFirstPage = useCallback((): void => {
    setPaging((current) => (current.page === 1 ? current : { ...current, page: 1 }));
  }, []);

  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const chosen = Number(event.target.value);
      setRatingFilter(isRatingValue(chosen) ? chosen : null);
      goToFirstPage();
    },
    [goToFirstPage],
  );

  const showAllRatings = useCallback((): void => {
    setRatingFilter(null);
    goToFirstPage();
  }, [goToFirstPage]);

  const focusReviewForm = useCallback((): void => {
    formRef.current?.focus();
  }, []);

  /** Refreshes the list a published review belongs to, leading it rather than leaving the reader elsewhere. */
  const handleSubmitted = (): void => {
    goToFirstPage();
    reviews.reload();
  };

  const loaded = reviews.data;
  const isReading = reviews.status === "idle" || reviews.status === "loading";
  const signInTo = loginPath(pathname);
  const sectionClass = className === undefined ? "sp-reviews" : `sp-reviews ${className}`;

  let body: ReactElement;

  if (isReading) {
    body = <ReviewPlaceholders />;
  } else if (reviews.error !== null) {
    body = (
      <Alert
        tone="danger"
        error={reviews.error}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={reviews.reload}
      />
    );
  } else if (loaded === null) {
    // Read finished with neither a payload nor a failure: nothing to show, so the placeholders stand rather
    // than an empty list that claims there are no reviews.
    body = <ReviewPlaceholders />;
  } else if (loaded.total === 0 && ratingFilter === null) {
    // Nothing has been written about this product yet. A visitor who cannot write is offered the session that
    // would let them, and one who can is taken to the form rather than told to look for it.
    body =
      session === null ? (
        <EmptyState
          surface="reviews"
          headingLevel={3}
          actionLabel={COMMON_ACTIONS.SIGN_IN}
          actionHref={signInTo}
        />
      ) : (
        <EmptyState surface="reviews" headingLevel={3} onAction={focusReviewForm} />
      );
  } else if (loaded.total === 0) {
    // The product has reviews, but none carries the rating this filter asks for: the wording says what the
    // filter left rather than what the product lacks, and the one action clears it.
    body = (
      <EmptyState
        headingLevel={3}
        title={EMPTY_STATES.reviews.title}
        description={EMPTY_STATES.catalogue.description}
        actionLabel={EMPTY_STATES.catalogue.actionLabel}
        onAction={showAllRatings}
      />
    );
  } else {
    body = (
      <>
        <ul className="sp-reviews__list" role="list">
          {loaded.items.map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </ul>
        {pager.pageCount > 1 ? (
          <Pagination
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            pageCount={pager.pageCount}
            hasNext={pager.hasNext}
            hasPrevious={pager.hasPrevious}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={(page): void => applyPaging(page, paging.pageSize)}
            onPageSizeChange={(pageSize): void => applyPaging(1, pageSize)}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className={sectionClass} aria-labelledby={headingId} aria-busy={isReading}>
      <h2 id={headingId}>{CATALOG_COPY.REVIEWS_HEADING}</h2>
      <div className="sp-reviews__summary">
        <p className="sp-reviews__date" role="status">
          {loaded === null ? "" : formatReviewCount(loaded.total)}
        </p>
        <Select
          label={CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL}
          options={RATING_FILTER_OPTIONS}
          value={ratingFilter === null ? "" : String(ratingFilter)}
          onChange={handleFilterChange}
        />
      </div>
      {body}
      {session === null ? (
        <SignInPrompt signInTo={signInTo} />
      ) : (
        <ReviewForm
          formRef={formRef}
          productId={productId}
          sessionToken={session.token}
          onSubmitted={handleSubmitted}
        />
      )}
    </section>
  );
}
