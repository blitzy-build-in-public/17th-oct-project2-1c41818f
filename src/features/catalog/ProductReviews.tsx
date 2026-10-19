/**
 * Path: src/features/catalog/ProductReviews.tsx
 * Purpose: The review list with rating filter and paging, and the review form for a signed-in customer
 * Lines: 600
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement, RefObject } from "react";

import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { usePagination } from "@/components/ui/hooks";
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
  PAGING_NOUNS,
  clearFacetLabel,
  helpfulCountLabel,
  reviewBodyLengthMessage,
  reviewTitleLengthMessage,
} from "@/constants/content";
import { loginPath } from "@/constants/routes";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import { listProductReviews, submitProductReview } from "@/lib/catalogService";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { handOffThen, useFocusHandoff } from "@/components/ui/focusHandoff";
import { useAsync } from "@/state/hooks";
import type { FacetId, RatingValue, Review, ReviewInput } from "@/types/catalog";
import type {
  FieldErrors,
  PageResult,
  ProductId,
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
 * Both review endpoints are reached through `src/lib/catalogService.ts`, the catalogue's service surface:
 * `listProductReviews` reads a page and `submitProductReview` publishes one, so this file names no request
 * path and holds no second copy of either call. The rules those calls depend on live where they already did
 * — the review rule in `src/utils/validation.ts`, and the statuses and refusal shapes in
 * `src/lib/apiClient.ts`, which the service forwards unchanged.
 *
 * Class contract. This list is what the sheets owe the surface, each class named with the sheet that
 * declares it. `src/styles/catalog-detail.css`, which `src/styles/catalog.css` loads with
 * `@import`, declares `sp-reviews`, its `__summary` row, its `__list` and `__item`, the
 * `__header`/`__author`/`__date` byline, the `__title` h3, the `__body` prose measure and the `__form` grid;
 * `src/styles/controls.css` owns `sp-form` and `sp-form__actions`, and the feedback primitives own theirs. The
 * summary's count and each row's helpful line borrow `__date`, the family's caption treatment, because the
 * sheet declares no rule of its own for either, and body type would outweigh the filter control beside it.
 *
 * Every string on this surface is `src/constants/content.ts`'s own, the empty state's included; the filter's
 * five choices are the bare numerals, because that module holds no wording for a rating either.
 */

/** The field keys the rule reports under, and the `name` each control carries, so one map lands on both. */
const REVIEW_FIELDS = { RATING: "rating", TITLE: "title", BODY: "body" } as const;

/** The filter's choices: every star, then the unfiltered one, so a cleared filter is a choice a reader can
 *  make rather than one only the empty state can restore. */
const RATING_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: "", label: CATALOG_COPY.ANY_RATING_LABEL },
  ...[5, 4, 3, 2, 1].map((star) => ({ value: String(star), label: String(star) })),
];

/** The facet the review filter narrows — the rating — named by the id the vocabulary indexes facets by. */
const RATING_FACET_ID: FacetId = "rating";

/** The rating facet as the vocabulary declares it, which is the one home for its label ("Customer rating"),
 *  or `undefined` where that module names no such facet. */
const RATING_FACET = FACET_DEFINITIONS.find((definition) => definition.id === RATING_FACET_ID);

/**
 * The wording of the filtered-empty state's one action: the content library's own clearing label for the facet
 * the review filter narrows ("Clear Customer rating"), so the control says exactly what it clears — the rating
 * alone, not every filter on the page. The catalogue's "Clear all filters" promised a wider reset than the
 * handler performs, and that label stands only as the fallback, where the vocabulary names no rating facet, so
 * the action is never wordless.
 */
const CLEAR_RATING_LABEL: string =
  RATING_FACET === undefined
    ? EMPTY_STATES.catalogue.actionLabel
    : clearFacetLabel(RATING_FACET.label);

/** The form as it opens: no star chosen, both fields empty. */
const EMPTY_REVIEW_DRAFT: ReviewDraft = { rating: undefined, title: "", body: "" };

/** The two length hints, each withdrawn for the field whose own message stands: that message names the bound
 *  that broke, so the general rule beside it would state the same rule twice in the control's description. */
const TITLE_HINT = reviewTitleLengthMessage(REVIEW_LIMITS.TITLE_MIN, REVIEW_LIMITS.TITLE_MAX);
const BODY_HINT = reviewBodyLengthMessage(REVIEW_LIMITS.BODY_MIN, REVIEW_LIMITS.BODY_MAX);

/** The placeholder rows the loading list stands in with, each keyed by its own identity, never an index. */
const PLACEHOLDER_ROW_KEYS = ["first", "second", "third"] as const;

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
 * One review: the rating it gives with its value as text, the reviewer, the day it was written, the verified
 * mark when the reviewer bought the product, the review itself and the readers who found it helpful.
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
        {review.verifiedPurchase ? (
          <Badge size="sm">{CATALOG_COPY.VERIFIED_PURCHASE_LABEL}</Badge>
        ) : null}
      </div>
      <h3 className="sp-reviews__title">{review.title}</h3>
      <p className="sp-reviews__body">{review.body}</p>
      <p className="sp-reviews__date">{helpfulCountLabel(review.helpfulCount)}</p>
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
 * the second submission a double click could start before that flag has rendered.
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
  /** The write in flight, so a form leaving the tree cancels it rather than reporting it to nothing. */
  const writeRef = useRef<AbortController | null>(null);
  // A write still in flight when the form leaves the tree is aborted, and its answer dropped below. One that
  // settles first is a submission the shopper completed before leaving: published, and confirmed by the toast.
  useEffect(() => () => writeRef.current?.abort(), []);
  /** The region the submission hands the focus off to: the form itself, which holds the control that starts the
   *  write and survives every outcome of it, and whose own heading names it wherever the focus lands. */
  const { handOffFocus } = useFocusHandoff(formRef);

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

  const submitReview = async (input: ReviewInput, signal: AbortSignal): Promise<void> => {
    const result = await submitProductReview(productId, input, { sessionToken, signal });
    // The form is gone — or a newer submission took over the write — so this answer belongs to nobody: nothing
    // here reports it to a screen the shopper has left, whatever the store kept of the row.
    if (signal.aborted) return;
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
    toasts.success(FEEDBACK_COPY.TOAST_REVIEW_SUBMITTED);
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
    // The write's own controller, superseding any earlier one and aborted with the form: the guard above holds
    // one submission in flight at a time, and this is what leaves that one with nothing to report once the
    // shopper has left the page that started it.
    writeRef.current?.abort();
    const controller = new AbortController();
    writeRef.current = controller;
    submittingRef.current = true;
    // Armed before the write: the submit control and every field are disabled for its duration, so the focus
    // they give up is claimed by the form rather than dropped onto the document body.
    handOffFocus();
    setIsSubmitting(true);
    const input: ReviewInput = { rating, title: draft.title.trim(), body: draft.body.trim() };
    void submitReview(input, controller.signal);
  };

  const titleHint = fieldErrors[REVIEW_FIELDS.TITLE] === undefined ? TITLE_HINT : undefined;
  const bodyHint = fieldErrors[REVIEW_FIELDS.BODY] === undefined ? BODY_HINT : undefined;

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
      <Alert tone="info">{CATALOG_COPY.REVIEW_FORM_NAME_NOTICE}</Alert>
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
        hint={titleHint}
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
        hint={bodyHint}
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
  /** What a published review reports to the surface above, whose own rating figures are a reading of the same
   *  rows this section lists; the list is refreshed here either way. */
  readonly onReviewPublished?: () => void;
}

/**
 * A product's reviews: what other customers wrote, narrowed by the rating filter and cut to a page, with the
 * form a signed-in customer submits through.
 *
 * The read belongs to this file and there is exactly one of it. The rating filter and the page are state of
 * this section rather than of the URL, because the URL's filter state is the catalogue's — the query
 * `src/utils/queryParams.ts` reads and writes is that one, and a product's reviews are a section of a page
 * rather than a listing of their own. Changing either one re-issues the read through `useAsync`, which aborts
 * the read it supersedes, so a slow page cannot overwrite the state of the one that replaced it.
 *
 * Paging is the shared control's, reached through `usePagination`, so the page count, the two bounds and the
 * page buttons cannot disagree with the payload the endpoint answered, and the caption beside them counts
 * reviews rather than the catalogue's products. The read itself is issued with the page the reader asked for
 * rather than with the clamped one, because while a page is in flight the previous total is not in hand and
 * clamping against an absent total would re-issue the first page instead of the chosen one.
 *
 * All four states are derived during render — the placeholders while the read is in flight, the failure's
 * alert with its retry, the empty state when the product holds no reviews or none match the filter, and the
 * list otherwise — so nothing is mirrored into state and no placeholder is shown beside a stale list. The
 * summary's count is an always-present polite live region, so a count changed by a filter is announced.
 *
 * A published review is a change to the review collection, so this section refreshes the list it owns and
 * reports the write above through `onReviewPublished`: left unreported, the list would move under a header
 * still stating the review set of the page's first read.
 *
 * @param props - The product to read reviews of, its extra classes, and the report a published review makes.
 * @returns The labelled section holding the summary, the reviews and the form.
 */
export function ProductReviews({
  productId,
  className,
  onReviewPublished,
}: ProductReviewsProps): ReactElement {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const headingId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);

  /*
   * The region every action below hands the focus off to, and the handoff they arm.
   *
   * A paged change destroys the pager and swaps the list for placeholder rows, the failure's retry leaves with
   * the failure it reports, and the empty state's own action leaves with the filter it clears — so in each case
   * the control the reader activated is unmounted and the browser would drop the focus onto `document.body`.
   * This section is rendered in every one of the read's states, and the heading it opens with names it, so the
   * handed-off focus lands in a region a screen reader announces. The rating filter needs no handoff: it is the
   * summary block's and keeps its place across the read.
   */
  const { regionRef, handOffFocus } = useFocusHandoff();

  const [ratingFilter, setRatingFilter] = useState<RatingValue | null>(null);
  const [paging, setPaging] = useState<{ readonly page: number; readonly pageSize: number }>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const reviews = useAsync<PageResult<Review>>(
    (signal) =>
      listProductReviews(
        productId,
        { page: paging.page, pageSize: paging.pageSize, rating: ratingFilter ?? undefined },
        { signal },
      ),
    [productId, paging.page, paging.pageSize, ratingFilter],
  );

  const applyPaging = useCallback(
    (page: number, pageSize: number): void => {
      // Armed before the write, so the focus moves with the commit that removes the pager.
      handOffFocus();
      setPaging({ page, pageSize });
    },
    [handOffFocus],
  );

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
    // Armed before the write: the empty state's own control leaves with the filter it clears.
    handOffFocus();
    setRatingFilter(null);
    goToFirstPage();
  }, [goToFirstPage, handOffFocus]);

  const focusReviewForm = useCallback((): void => {
    formRef.current?.focus();
  }, []);

  /** Refreshes the list a published review belongs to, leading it rather than leaving the reader elsewhere, and
   *  reports the write above so the product's own rating figures are read again beside it. */
  const handleSubmitted = (): void => {
    goToFirstPage();
    reviews.reload();
    onReviewPublished?.();
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
        onAction={handOffThen(handOffFocus, reviews.reload)}
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
          headingLevel={2}
          actionLabel={COMMON_ACTIONS.SIGN_IN}
          actionHref={signInTo}
        />
      ) : (
        <EmptyState surface="reviews" headingLevel={2} onAction={focusReviewForm} />
      );
  } else if (loaded.total === 0) {
    // The product has reviews, but none carries the rating this filter asks for: the wording says what the
    // filter left rather than what the product lacks, and the one action clears it — the rating alone, which
    // is what the action's label names.
    body = (
      <EmptyState
        headingLevel={2}
        title={EMPTY_STATES.reviews.title}
        description={EMPTY_STATES.catalogue.description}
        actionLabel={CLEAR_RATING_LABEL}
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
            // The rows are reviews, so the caption counts reviews rather than the catalogue's products.
            countNoun={PAGING_NOUNS.REVIEWS}
            // The summary above announces the count from its own always-present region, so this defers to it.
            isCountAnnouncedByCaller
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={(page): void => applyPaging(page, paging.pageSize)}
            onPageSizeChange={(pageSize): void => applyPaging(1, pageSize)}
          />
        ) : null}
      </>
    );
  }

  return (
    <section
      className={sectionClass}
      aria-labelledby={headingId}
      aria-busy={isReading}
      ref={regionRef}
      tabIndex={-1}
    >
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
