/**
 * Path: src/features/account/ProfilePage.tsx
 * Purpose: Profile view and edit with validation and a success confirmation
 * Lines: 347
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Select";
import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  LOYALTY_TIER_LABELS,
  PAGE_TITLES,
  documentTitle,
} from "@/constants/content";
import {
  displayName,
  getProfile,
  toProfileFieldErrors,
  updateProfile,
} from "@/lib/customerService";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { Customer, ProfileUpdateInput } from "@/types/account";
import type { FieldErrors, Result } from "@/types/common";
import { formatDate } from "@/utils/dates";
import {
  FORM_ERROR_KEY,
  clearFieldError,
  hasErrors,
  validateProfileUpdate,
} from "@/utils/validation";

/*
 * Class contract. `src/styles/account.css` is the sole definition site of the profile family and no file
 * under `src/features/**` imports a stylesheet, so every class below is consumed by name: `sp-profile` for the
 * section, `sp-profile__header` and `sp-profile__meta` for the identity line above the form,
 * `sp-profile__form` for the form itself, and `sp-profile__success` for the confirmation the form writes into
 * an aria-live region. The two markup hooks that sheet publishes for what a fixed class list cannot carry are
 * honoured here: `data-span="full"` on the field that crosses the form grid, which is why the read-only email
 * sits in a wrapper carrying that attribute, and nothing else. The grid, the field family and the choice row
 * are `sp-form__grid`, `sp-form__actions`, `sp-field`, `sp-input` and `sp-choice` from
 * `src/styles/controls.css`, reached through the components rather than written here; a field the account
 * cannot change is `readonly` rather than disabled, so its value stays focusable and copyable.
 */

/** The four controls the loading state stands in for, keyed by the member each will carry. */
const PLACEHOLDER_FIELDS = ["email", "firstName", "lastName", "phone"] as const;

/** The mark the confirmation draws in the column the sheet reserves for it: decoration, because the sentence
 *  beside it carries the outcome, and a character, so nothing is loaded, sized or announced twice. */
const SAVED_MARK = "✓";

/**
 * The four members `PATCH /api/customers/:id` accepts, taken from the record a read returned.
 *
 * This is the form's own projection of what may be edited, not a rule: the email identifies the account, the
 * role, the loyalty label and the timestamps belong to the data layer, and an address moves through its own
 * endpoints — none of them is part of the body, so none appears here.
 *
 * @param customer - The account as the seam last served it.
 * @returns The body an edit starts from.
 */
function profileInputOf(customer: Customer): ProfileUpdateInput {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
  };
}

/**
 * The signed-in customer's profile: the account's own record, the four members the profile endpoint accepts,
 * and the confirmation a save leaves behind.
 *
 * The page owns no profile rule of its own. `src/lib/customerService.ts` reads and writes the record, judges
 * every body with the same `validateProfileUpdate` the seam runs over it, and says what a refusal means for a
 * control; `src/utils/validation.ts` owns the field rules; and `src/state/AuthContext.tsx` owns the session, so
 * the account id and the token come from it and this page invents neither — which is also what keeps another
 * account's record out of reach, since the seam answers `403` for an id the session does not own.
 *
 * Failures are values rather than exceptions, so nothing here catches one: a failed read renders the shared
 * error state with a retry action, and a failed write lands on the control it belongs to or, when it names no
 * control, on the toast where the customer is looking. A save confirms itself twice over: the sentence the
 * sheet's aria-live block carries, which is what a screen reader announces on this page, and a toast for the
 * transient feedback both surfaces can rely on.
 *
 * @returns The profile section, with its form and its confirmation.
 */
export function ProfilePage(): ReactElement {
  useDocumentTitle(documentTitle(PAGE_TITLES.ACCOUNT));

  const { session } = useAuth();
  const { refresh } = useAuthDispatch();
  const toasts = useToast();
  const headingId = useId();

  // The session is the only source of the id these endpoints are scoped by and of the token that carries it,
  // so nothing here assembles either. With no session the read is suppressed and the section says why.
  const customerId = session?.customerId ?? null;
  const sessionToken = session?.token;

  /** The members the customer has typed, or `null` while the form still shows what was stored. */
  const [draft, setDraft] = useState<ProfileUpdateInput | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const loadProfile = (signal: AbortSignal): Promise<Result<Customer | null>> =>
    customerId === null
      ? // Nothing to read without a session: the run below is suppressed, and reporting no profile is what
        // lets the section render its signed-out warning rather than an error state for a request that was
        // never sent.
        Promise.resolve<Result<Customer | null>>({ ok: true, value: null })
      : getProfile(customerId, { sessionToken, signal });

  const {
    data,
    error,
    reload: reloadProfile,
    status,
  } = useAsync<Customer | null>(loadProfile, [customerId, sessionToken], {
    enabled: customerId !== null,
  });

  /** The record the read returned, or `null` while it is in flight or while there is no session. */
  const profile = data;

  /**
   * What the form shows and what the identity line above it reads: the draft the customer has typed, or the
   * stored record while none is typed. Derived during render rather than mirrored into state, so the two
   * cannot disagree and no effect has to keep them in step — which is also why the name reads as it was typed
   * rather than as it was stored while an edit is unsaved.
   */
  const values: ProfileUpdateInput | null =
    profile === null ? null : (draft ?? profileInputOf(profile));

  /**
   * Applies one member's change to the draft, clears that member's message and withdraws the confirmation.
   *
   * The confirmation is withdrawn because it describes the values that were sent: leaving it in place once a
   * control changes would claim a save that has not happened yet.
   *
   * @param patch - The member changed and its new value.
   */
  const editDraft = (patch: Partial<ProfileUpdateInput>): void => {
    if (values === null) return;
    setDraft({ ...values, ...patch });
    setFieldErrors((errors) =>
      Object.keys(patch).reduce((next, member) => clearFieldError(next, member), errors),
    );
    setIsSaved(false);
  };

  const changeFirstName = (event: ChangeEvent<HTMLInputElement>): void => {
    editDraft({ firstName: event.target.value });
  };

  const changeLastName = (event: ChangeEvent<HTMLInputElement>): void => {
    editDraft({ lastName: event.target.value });
  };

  const changePhone = (event: ChangeEvent<HTMLInputElement>): void => {
    editDraft({ phone: event.target.value });
  };

  const changeMarketingOptIn = (marketingOptIn: boolean): void => {
    editDraft({ marketingOptIn });
  };

  /**
   * Judges the form, sends it, and reports what came back.
   *
   * The body is judged before it is sent by the rule the seam applies to the same body, so a mistyped field is
   * refused with the control it belongs to rather than after a round trip. A second submission is blocked by
   * the in-flight flag as well as by the disabled control, because the submit event can also arrive from a
   * keypress. A refusal leaves the typed values exactly as they are.
   */
  const saveProfile = async (): Promise<void> => {
    if (customerId === null || values === null || isSaving) return;
    const errors = validateProfileUpdate(values);
    if (hasErrors(errors)) {
      setFieldErrors(errors);
      setIsSaved(false);
      return;
    }
    setIsSaving(true);
    const result = await updateProfile(customerId, values, { sessionToken });
    setIsSaving(false);
    if (!result.ok) {
      const mapped = toProfileFieldErrors(result.error);
      setFieldErrors(mapped);
      // A refusal naming no control has nowhere to sit in the form, so it is reported where the customer is
      // looking; one naming a control is already rendered against it and needs no second telling.
      if (FORM_ERROR_KEY in mapped) toasts.error(result.error.message);
      return;
    }
    // The answer is the stored record, so the form adopts it instead of keeping the values it sent: a value
    // the data layer normalised is then shown as it was stored.
    setDraft(profileInputOf(result.value));
    setFieldErrors({});
    setIsSaved(true);
    toasts.success(FEEDBACK_COPY.TOAST_PROFILE_SAVED);
    // The header's account menu reads the identity projection the session context holds, and this page is the
    // only surface that changes the name behind it, so the projection is refreshed with the save.
    await refresh();
  };

  const submitProfile = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void saveProfile();
  };

  /**
   * Renders what stands below the identity line, in the order the four states are reached.
   *
   * There is no empty state: a signed-in customer always has a profile, so a successful read is the only state
   * the form is built from. The absence of a session is a visitor who has to sign in rather than an empty
   * profile — the guard over `/account/*` sends them there — and the warning is what remains on screen for the
   * instant before that navigation completes.
   *
   * @returns The signed-out warning, the error state, the loading skeleton, or the form with its confirmation.
   */
  const renderBody = (): ReactElement => {
    if (customerId === null) {
      return <Alert tone="warning">{FEEDBACK_COPY.SIGN_IN_REQUIRED}</Alert>;
    }
    if (status === "error" && error !== null) {
      return (
        <Alert
          actionLabel={COMMON_ACTIONS.RETRY}
          error={error}
          onAction={reloadProfile}
          tone="danger"
        />
      );
    }
    if (profile === null) {
      return (
        <div aria-busy="true" className="sp-profile__form">
          <div className="sp-form__grid">
            {PLACEHOLDER_FIELDS.map((field) => (
              <Skeleton key={field} height="var(--control-height-md)" variant="block" />
            ))}
          </div>
        </div>
      );
    }
    const formValues = values ?? profileInputOf(profile);
    return (
      <>
        <form className="sp-profile__form" noValidate onSubmit={submitProfile}>
          <div className="sp-form__grid">
            {/* The email identifies the account and the profile endpoint cannot change it, so it is shown as a
                read-only control — focusable and copyable, never disabled — and it crosses both columns. */}
            <div data-span="full">
              <Input
                autoComplete="email"
                hint={ACCOUNT_COPY.PROFILE_EMAIL_HINT}
                label={ACCOUNT_COPY.EMAIL_LABEL}
                name="email"
                readOnly
                type="email"
                value={profile.email}
              />
            </div>
            <Input
              autoComplete="given-name"
              errors={fieldErrors}
              label={ACCOUNT_COPY.FIRST_NAME_LABEL}
              name="firstName"
              onChange={changeFirstName}
              required
              value={formValues.firstName}
            />
            <Input
              autoComplete="family-name"
              errors={fieldErrors}
              label={ACCOUNT_COPY.LAST_NAME_LABEL}
              name="lastName"
              onChange={changeLastName}
              required
              value={formValues.lastName}
            />
            <Input
              autoComplete="tel"
              errors={fieldErrors}
              label={ACCOUNT_COPY.PHONE_LABEL}
              name="phone"
              onChange={changePhone}
              type="tel"
              value={formValues.phone}
            />
            <Switch
              checked={formValues.marketingOptIn}
              label={ACCOUNT_COPY.MARKETING_OPT_IN_LABEL}
              onChange={changeMarketingOptIn}
            />
          </div>
          <div className="sp-form__actions">
            {/* An in-flight submit cannot be sent twice: the control is disabled and busy while the request
                stands, and the handler refuses a second submission of its own. */}
            <Button isLoading={isSaving} type="submit" variant="primary">
              {COMMON_ACTIONS.SAVE_CHANGES}
            </Button>
          </div>
        </form>
        {isSaved ? (
          // Written only once a save has succeeded, so nothing announces on load. The mark beside the sentence
          // is decoration: the words carry the outcome.
          <div className="sp-profile__success" role="status">
            <span aria-hidden="true">{SAVED_MARK}</span>
            <p>{FEEDBACK_COPY.TOAST_PROFILE_SAVED}</p>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section aria-labelledby={headingId} className="sp-profile">
      <div className="sp-profile__header">
        {/* The account area's single <h1> belongs to AccountLayout, so this section opens at the level below
            it and no second first-level heading reaches the account tree. */}
        <h2 id={headingId}>{ACCOUNT_COPY.PROFILE_HEADING}</h2>
        {profile === null || values === null ? null : (
          <p className="sp-profile__meta">
            <span>{displayName(values)}</span>
            <span>{ACCOUNT_COPY.PROFILE_TIER_LABEL}</span>
            <Badge variant="info">{LOYALTY_TIER_LABELS[profile.loyaltyTier]}</Badge>
            <span>{`${ACCOUNT_COPY.PROFILE_MEMBER_SINCE_LABEL}: ${formatDate(profile.createdAt, "long")}`}</span>
          </p>
        )}
      </div>
      {renderBody()}
    </section>
  );
}
