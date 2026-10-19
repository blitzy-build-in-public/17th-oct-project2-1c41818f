/**
 * Path: src/features/account/RegisterPage.tsx
 * Purpose: Registration form with field validation and duplicate-email handling
 * Lines: 430
 */

import { useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Select";
import { PASSWORD_POLICY } from "@/constants/config";
import {
  ACCOUNT_COPY,
  A11Y_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  PAGE_TITLES,
  documentTitle,
  passwordHintLabel,
  registeredMessage,
  signedInMessage,
} from "@/constants/content";
import { RETURN_TO_QUERY_KEY, ROUTES, canReachPath, loginPath } from "@/constants/routes";
import { toAuthFieldErrors } from "@/lib/authService";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { useFocusHandoff } from "@/components/ui/focusHandoff";
import { useRefusalFocus } from "@/state/focusHooks";
import { useDocumentTitle } from "@/state/hooks";
import type { RegistrationInput, Role } from "@/types/account";
import type { FieldErrors } from "@/types/common";
import {
  FORM_ERROR_KEY,
  clearFieldError,
  hasErrors,
  validateRegistration,
} from "@/utils/validation";

/*
 * Class contract. `src/styles/account.css` is the sole definition site of the sign-in and registration block,
 * and this list is what the sheets owe the file, each class named with the sheet that declares it:
 * `sp-container` with `sp-container--narrow` is `src/styles/layout.css`'s one geometry rule for the page's
 * width and inline gutter, which the route carries itself because the shell's main region pads the block flow
 * only; `section.sp-auth` — named through `aria-labelledby` by the heading of whichever of the three states
 * is rendered — is the labelled-region landmark this route exposes, and inside it `sp-auth__panel` — carried
 * beside the `sp-card` surface that gives it its border, radius and shadow — is the panel at the narrow
 * container's measure, `sp-auth__header`, `sp-auth__title` and `sp-auth__lede` open it, `sp-auth__form`
 * stacks its fields, `sp-auth__alert` leaves room for the form-level failure, and `sp-auth__switch` is the
 * rule-and-link line that puts the sign-in screen one click away. The field family, the button family and the
 * loading placeholder are `controls.css` and `components.css`, reached through the primitives. The sheet
 * declares the narrow reflow, so this file holds no media query and no design value of its own.
 */

/**
 * The four typed members of the registration body, keyed by the name each control carries, so one field list
 * and one change handler serve them all. `marketingOptIn` is the body's fifth member and is held on its own,
 * because a switch is a choice rather than a value a control names.
 */
type RegistrationFieldName = "email" | "password" | "firstName" | "lastName";

/** The typed values the form holds, keyed by the body member each field writes. */
type RegistrationDraft = Record<RegistrationFieldName, string>;

/** What the form opens with: every field empty, and the consent switch off. */
const BLANK_DRAFT: RegistrationDraft = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
};

/**
 * One text field of the form: the body member it writes, the words its label carries and the member's two
 * browser hints. Stating these once per field is what keeps the rendered controls a single call site rather
 * than four near-identical blocks.
 */
interface RegistrationFieldSpec {
  /** The body member the control writes, which is also the `name` its error is filed under. */
  readonly member: RegistrationFieldName;
  /** The control's label, read from the copy the account screens share. */
  readonly label: string;
  /** The input type, which is also the test for the one field carrying a reveal toggle. */
  readonly type: "text" | "email" | "password";
  /** What the browser's own autofill is told this field is. */
  readonly autoComplete: string;
  /** A supporting line under the control: the password field states its rule here. */
  readonly hint?: string;
}

/**
 * The five members `POST /api/auth/register` accepts, in the order the form renders them: first and last name,
 * the address, the password whose rule is phrased from `PASSWORD_POLICY`, and — off this list — the consent
 * choice. The password is judged by `validatePassword` and the names by `validateName`, both reached through
 * `validateRegistration`, so no rule is restated at the call site.
 */
const REGISTRATION_FIELDS: readonly RegistrationFieldSpec[] = [
  {
    member: "firstName",
    label: ACCOUNT_COPY.FIRST_NAME_LABEL,
    type: "text",
    autoComplete: "given-name",
  },
  {
    member: "lastName",
    label: ACCOUNT_COPY.LAST_NAME_LABEL,
    type: "text",
    autoComplete: "family-name",
  },
  {
    member: "email",
    label: ACCOUNT_COPY.EMAIL_LABEL,
    type: "email",
    autoComplete: "email",
  },
  {
    member: "password",
    label: ACCOUNT_COPY.PASSWORD_LABEL,
    type: "password",
    autoComplete: "new-password",
    hint: passwordHintLabel(PASSWORD_POLICY.MIN_LENGTH),
  },
];

/** How many placeholder lines the loading state stands in for: one per field the form will render. */
const PLACEHOLDER_LINE_COUNT = REGISTRATION_FIELDS.length;

/** The width of the placeholder heading, in a relative unit so it follows the reader's text size. */
const PLACEHOLDER_HEADING_WIDTH = "18ch";

/**
 * The role a completed registration holds: `POST /api/auth/register` opens a customer session and no other,
 * so a preserved path is judged against it while the form is on screen.
 */
const REGISTRATION_ROLE: Role = "customer";

/**
 * The path a preserved return value names, when it is one this application may navigate to.
 *
 * The value arrives from the address bar, so it is treated as untrusted: only a same-origin path — one that
 * opens with a single separator — is returned, which refuses an absolute or protocol-relative address a
 * hand-made link could carry. `undefined` sends the caller to the account instead, so a refused value costs
 * the visitor a redirect rather than a route nobody wrote.
 *
 * Origin is the whole of the question settled here. Whether the visitor's role can open the path this
 * returns is judged where the destination is settled, through `canReachPath` in `src/constants/routes.ts`,
 * because a caller needs the raw path as well: the link across to the sign-in screen carries it on for a
 * visitor whose own role may reach it once they are signed in.
 *
 * @param value - The raw query value, or `null` when the route carried none.
 * @returns The path to navigate to, or `undefined` when the value is not one.
 */
function returnPathOf(value: string | null): string | undefined {
  if (value === null) return undefined;
  const path = value.trim();
  return path.startsWith("/") && !path.startsWith("//") ? path : undefined;
}

/**
 * The registration route: the account fields `POST /api/auth/register` accepts, judged before they are sent,
 * with the outcome landed and announced.
 *
 * Three states are rendered, in the order the session's own progress reaches them. While the mount
 * revalidation of a stored session is still running, the panel holds a placeholder shaped like the form, so
 * a visitor who is already signed in is never shown a registration form that would be replaced a moment
 * later. A visitor whose session stands is told so and offered the way on, because a page that still asked
 * them to register would be asking for something they have. That panel states the outcome this visit met:
 * the greeting this page's own registration raised while the session it opened is being moved away from, and
 * the sign-in greeting for a visitor who arrived already holding one. Everything else renders the form.
 *
 * The page guards nothing: it hands the visitor to the account route — or to the path a guarded route
 * preserved, when the role the move happens under can open it — and `src/Router.tsx` is what refuses a screen
 * the session cannot serve. Registration itself is an anonymous endpoint, and the session the seam answers
 * with carries the role the seam issued and no other — `REGISTRATION_ROLE` states which — so a role is read
 * from the session here and never chosen on the form.
 *
 * @returns The registration panel in whichever of its three states applies.
 */
export function RegisterPage(): ReactElement {
  // One id names the region whichever state renders, because exactly one of the three is in the document at
  // a time: `section.sp-auth` points at it through `aria-labelledby`, so the route exposes the same labelled
  // landmark the sign-in screen exposes.
  const headingId = useId();
  useDocumentTitle(documentTitle(PAGE_TITLES.REGISTER));

  const { register } = useAuthDispatch();
  const { status, isAuthenticated, displayName, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [draft, setDraft] = useState<RegistrationDraft>(BLANK_DRAFT);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The greeting this page's own registration raised, or `null` for a visitor who arrived already signed in.
  // The panel the session's own branch renders outlives the navigation that follows a registration by a
  // render or two, so without it that panel would greet an account created a moment ago with the sentence
  // the sign-in screen keeps for a visitor who returned.
  const [registeredGreeting, setRegisteredGreeting] = useState<string | null>(null);

  /** The region the request's own failure is stated in and the form it was raised from: what a refused
   *  registration hands the keyboard to, whether the store named a control or answered about the form itself. */
  const alertRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const preservedPath = returnPathOf(searchParams.get(RETURN_TO_QUERY_KEY));
  // `canReachPath` in `src/constants/routes.ts` is the one home of the role-to-section rule, and the check the
  // sign-in screen applies to this same value, so no second test is written here. The role judged is the one
  // the move happens under: the session a visitor already holds while the signed-in panel is on screen, and
  // the `customer` session a registration opens otherwise — because a registration can never honour a path
  // only an administrator may open, and handing that path to the guard would answer a visitor who has just
  // created an account with a refusal rather than with the account they now hold.
  const destination =
    preservedPath !== undefined &&
    canReachPath(preservedPath, isAuthenticated ? role : REGISTRATION_ROLE)
      ? preservedPath
      : ROUTES.ACCOUNT;
  const formError: string | undefined = errors[FORM_ERROR_KEY];
  // The placeholder belongs to the session restore and not to a submission: while a submission is in flight
  // the control that started it reports the wait, and standing a placeholder over the form would take that
  // control off the page in the middle of the click that used it.
  const isRestoring = status === "loading" && !isSubmitting;
  // What the session's own panel greets the visitor with: the sentence this page's registration raised, or the
  // returning visitor's. A session whose identity projection has not resolved yet has no name to put in that
  // sentence, and the panel leaves it out rather than render one with a name missing from it — the guard
  // `LoginPage` applies to the same panel.
  const signedInLede =
    registeredGreeting ?? (displayName.trim().length > 0 ? signedInMessage(displayName) : null);

  // A refused registration is answered with the alert when the failure names no control, and otherwise on the
  // first control it did name: one move, through the hook every other refusal uses.
  useRefusalFocus(hasErrors(errors), alertRef, formRef);

  /**
   * The region a submission hands the focus off to: the form itself, which holds the control that starts the
   * request and every control a refusal is reported on. The form's own `formRef` is that region, so one element
   * carries both moves — the handoff and the refusal focus above — rather than two refs on one form.
   *
   * The submit control is disabled for as long as the request runs and each field with it, so a disabled control
   * cannot hold the focus and the commit that starts the request drops it onto the document body — before the
   * refusal has been rendered at all. The form takes it instead, so a reader whose submission was refused stays
   * in the panel with its fields and its messages. A registration that succeeds opens the session and navigates,
   * which unmounts the form: nothing is moved on that path, because the route change moves the focus.
   */
  const { handOffFocus } = useFocusHandoff<HTMLFormElement>(formRef);

  /**
   * Writes one control's value into the draft and clears that control's message, so a corrected field stops
   * reporting the moment it is edited rather than standing until the next submission. The message above the
   * fields belongs to the request rather than to one control, so it stays until the form is sent again.
   */
  function handleFieldChange(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
    setErrors((current) => clearFieldError(current, name));
  }

  /**
   * Creates the account and lands the visitor. Registration opens the session with it, so nothing signs in
   * afterwards and no second request follows the first. A failure is a value: an address already taken comes
   * back with the email field named and is filed on that field, and anything else is shown above the fields,
   * because a failure that names no field is not one to attach to a control.
   *
   * @param input - The registration body, already judged by the local rule.
   */
  async function submit(input: RegistrationInput): Promise<void> {
    const answer = await register(input);
    setIsSubmitting(false);
    if (!answer.ok) {
      setErrors(toAuthFieldErrors(answer.error));
      return;
    }
    // The greeting is built once from the account this registration created and held, so the toast and the
    // panel the session's branch renders until the navigation lands below carry the same sentence and both
    // name the occasion the visitor met rather than the session they hold.
    const greeting = registeredMessage(answer.value.customer.firstName);
    toast.success(greeting);
    setRegisteredGreeting(greeting);
    // `replace` so the registration screen is not a step the back button returns to once the visitor is in.
    void navigate(destination, { replace: true });
  }

  /**
   * Judges what was entered before anything is sent, so a malformed form never reaches the transport, and
   * refuses a second submission while the first is in flight — the same guard the disabled control reports.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSubmitting) return;
    const input: RegistrationInput = { ...draft, marketingOptIn };
    const found = validateRegistration(input);
    if (hasErrors(found)) {
      setErrors(found);
      return;
    }
    setErrors({});
    // Armed before the request: the submit control and every field are disabled for its duration, and the
    // focus they give up belongs inside the form rather than on the document body.
    handOffFocus();
    setIsSubmitting(true);
    void submit(input);
  }

  const passwordToggle = (
    <Button
      variant="link"
      size="sm"
      disabled={isSubmitting}
      aria-pressed={isPasswordVisible}
      onClick={() => {
        setIsPasswordVisible((visible) => !visible);
      }}
    >
      {isPasswordVisible ? ACCOUNT_COPY.HIDE_PASSWORD_LABEL : ACCOUNT_COPY.SHOW_PASSWORD_LABEL}
    </Button>
  );

  if (isRestoring) {
    return (
      <div className="sp-container sp-container--narrow">
        <section aria-busy="true" aria-labelledby={headingId} className="sp-auth">
          <Card className="sp-auth__panel">
            {/* The heading the skeleton stands in for: out of sight, because this state deliberately withholds
                the registration title from a visitor who may already hold a session, but present so the region
                carries a name of its own while the form it stands for loads. */}
            <h1 className="sp-visually-hidden" id={headingId}>
              {ACCOUNT_COPY.REGISTER_HEADING}
            </h1>
            <span className="sp-visually-hidden">{A11Y_COPY.LOADING_ANNOUNCEMENT}</span>
            <Skeleton variant="heading" width={PLACEHOLDER_HEADING_WIDTH} />
            <Skeleton lines={PLACEHOLDER_LINE_COUNT} />
          </Card>
        </section>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="sp-container sp-container--narrow">
        <section aria-labelledby={headingId} className="sp-auth">
          <Card className="sp-auth__panel">
            <header className="sp-auth__header">
              <h1 className="sp-auth__title" id={headingId}>
                {PAGE_TITLES.ACCOUNT}
              </h1>
              {signedInLede === null ? null : <p className="sp-auth__lede">{signedInLede}</p>}
            </header>
            <Link className="sp-btn sp-btn--primary sp-btn--block" to={destination}>
              {COMMON_ACTIONS.CONTINUE}
            </Link>
          </Card>
        </section>
      </div>
    );
  }

  return (
    <div className="sp-container sp-container--narrow">
      <section aria-labelledby={headingId} className="sp-auth">
        <Card className="sp-auth__panel">
          <header className="sp-auth__header">
            <h1 className="sp-auth__title" id={headingId}>
              {ACCOUNT_COPY.REGISTER_HEADING}
            </h1>
            <p className="sp-auth__lede">{ACCOUNT_COPY.REGISTER_SUBHEADING}</p>
          </header>

          {/* `noValidate` leaves the judging to `src/utils/validation.ts` rather than to the browser, so a
              refusal is worded once and the field keeps the `required` markup assistive technology reads. */}
          <form
            className="sp-auth__form"
            onSubmit={handleSubmit}
            noValidate
            ref={formRef}
            tabIndex={-1}
          >
            {formError === undefined ? null : (
              <div className="sp-auth__alert" ref={alertRef} tabIndex={-1}>
                <Alert tone="danger" title={FEEDBACK_COPY.ERROR_STATE_TITLE}>
                  {formError}
                </Alert>
              </div>
            )}

            {REGISTRATION_FIELDS.map((field) => (
              <Input
                key={field.member}
                name={field.member}
                label={field.label}
                hint={field.hint}
                type={field.type === "password" && isPasswordVisible ? "text" : field.type}
                autoComplete={field.autoComplete}
                errors={errors}
                isDisabled={isSubmitting}
                required
                value={draft[field.member]}
                onChange={handleFieldChange}
                trailingAddon={field.type === "password" ? passwordToggle : undefined}
              />
            ))}

            <Switch
              label={ACCOUNT_COPY.MARKETING_OPT_IN_LABEL}
              checked={marketingOptIn}
              isDisabled={isSubmitting}
              onChange={setMarketingOptIn}
            />

            <Button type="submit" isBlock isLoading={isSubmitting}>
              {ACCOUNT_COPY.REGISTER_SUBMIT_LABEL}
            </Button>
          </form>

          <p className="sp-auth__switch">
            <Link className="sp-btn sp-btn--link" to={loginPath(preservedPath)}>
              {ACCOUNT_COPY.GO_TO_SIGN_IN_LABEL}
            </Link>
          </p>
        </Card>
      </section>
    </div>
  );
}
