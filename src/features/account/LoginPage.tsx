/**
 * Path: src/features/account/LoginPage.tsx
 * Purpose: Sign-in form with inline validation and return-path preservation
 * Lines: 376
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button, ButtonGroup } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import {
  ACCOUNT_ACCESS_COPY,
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  PAGE_TITLES,
  documentTitle,
  signedInMessage,
} from "@/constants/content";
import { RETURN_TO_QUERY_KEY, ROUTES, canReachPath, registerPath } from "@/constants/routes";
import { authErrorMessage, roleHomePath, toAuthFieldErrors } from "@/lib/authService";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { useDocumentTitle } from "@/state/hooks";
import type { Credentials } from "@/types/account";
import type { ApiError, FieldErrors, SessionToken } from "@/types/common";
import { FORM_ERROR_KEY, clearFieldError, hasErrors, validateSignIn } from "@/utils/validation";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only
 * importer of `src/styles/**` — so every class below is consumed by name. `src/styles/account.css` owns
 * the sign-in family: `sp-auth` for the centred region, `sp-auth__panel` for the single panel on the
 * `sp-card` frame `src/styles/data-display.css` declares, `sp-auth__header`, `sp-auth__title` (this
 * screen's `<h1>`), `sp-auth__lede`, `sp-auth__form` for the field grid, `sp-auth__alert` for the slot the
 * form-level failure sits in, and `sp-auth__switch` for the line across to registration. The panel carries
 * `sp-auth__form` for its restoring placeholder too, which is what keeps that placeholder in the same grid
 * as the form it stands in for. `sp-container` with `sp-container--narrow` is `src/styles/layout.css`'s one
 * geometry rule for a page's width and inline gutter, which a route carries itself because the shell's main
 * region pads the block flow only. `src/styles/controls.css` supplies the skins the primitives render:
 * `sp-field` with its `__label`, `__required`, `__control`, `__hint` and `__error` parts, `sp-input`,
 * `sp-btn` with its `--primary`, `--secondary`, `--block` and `--link` modifiers — worn by the submit, the
 * refusal's pair of controls and the switch link — and `sp-btn-group` for the row those two controls are
 * arranged in.
 */

// The form's shape and the state it reads ----------------------------------------------------------

/**
 * The credentials the form opens with, so both controls are controlled from the first keystroke rather
 * than switching from an uncontrolled to a controlled value at it.
 */
const BLANK_CREDENTIALS: Credentials = { email: "", password: "" };

/**
 * What a preserved return path must begin with to stay inside this application: `ROUTES.HOME` is the root
 * segment the router writes at the front of every in-app destination, and its doubled form is the
 * protocol-relative address that would name another host. Both are read from the route constants, so no
 * path is written as a literal in this file.
 */
const IN_APP_PREFIX = ROUTES.HOME;
const FOREIGN_PREFIX = ROUTES.HOME.repeat(2);

/** One control of the sign-in form: the body member it writes and what the control itself carries. */
interface SignInFieldSpec {
  /** The member of `Credentials` this control writes. */
  readonly member: keyof Credentials;
  /** The field's label, which is the control's accessible name. */
  readonly label: string;
  /** The input type the credential is entered as. */
  readonly type: "email" | "password";
  /** The autocomplete hint a password manager fills from. */
  readonly autoComplete: string;
}

/**
 * The two fields in the order the form renders them, so each one's label, input type and autocomplete
 * hint are stated once and the form maps over the list instead of repeating the same control twice. Every
 * label is the copy library's.
 */
const SIGN_IN_FIELDS: readonly SignInFieldSpec[] = [
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
    autoComplete: "current-password",
  },
];

/** One placeholder line per control the restoring state stands in for. */
const RESTORING_FIELD_LINES = SIGN_IN_FIELDS.length;

/**
 * The path a preserved return path names, or `null` when there is nothing safe to navigate to.
 *
 * `src/Router.tsx` writes this value when it turns an unauthorised visitor away, so it is read and never
 * re-derived from history. It is judged before it is navigated to all the same: the destination has to be
 * inside this application, which is what refuses the protocol-relative address that would leave the site
 * for another host. A hand-made link is the case, not a defect in the redirect.
 *
 * @param raw - The query value as it arrived, or `null` when the key is absent.
 * @returns The in-application path to continue to, or `null` for a value that names none.
 */
function intendedPath(raw: string | null): string | null {
  if (raw === null) return null;
  const path = raw.trim();
  if (!path.startsWith(IN_APP_PREFIX) || path.startsWith(FOREIGN_PREFIX)) return null;
  return path;
}

// The screen --------------------------------------------------------------------------------------

/**
 * The sign-in route of the customer accounts slice.
 *
 * It renders one of four states from what the session context holds and what the route asks for: a
 * placeholder shaped like the form while the stored session is being revalidated; a refusal for a visitor
 * who is signed in and, through the path the guard preserved, asked for a page their role cannot reach;
 * the panel's own "already signed in" state for a signed-in visitor whose destination is open to them; and
 * the form itself for everyone else. A signed-in visitor therefore never sits in front of a sign-in form, a
 * returning one never sees the form flash before their session resolves, and neither is offered a control
 * that leads back into the refusal they arrived from.
 *
 * The page owns no authentication rule. `src/lib/authService.ts` decides what a session is, how long it
 * lasts and how a refusal is worded, and `src/utils/validation.ts` decides what the form may be submitted
 * with, so the only judgement made here is which of the two messages a failure becomes: a complaint about
 * a member the store named, or the one generic sentence a refused sign-in is answered with, which names
 * neither member because a failure that pointed at one would tell a stranger which addresses have
 * accounts. Failures arrive as `Result` values, so nothing here catches anything.
 *
 * The unauthenticated redirect belongs to `src/Router.tsx`, which guards `/account/*`; this page guards
 * nothing and instead reads the path that guard preserved, landing the visitor on it once the session is
 * established — the role's own home when the guard left no such path, and again when the path it left is
 * one `canReachPath` says the role cannot open, which is the case stated here as a refusal rather than as a
 * way on. Authentication is an in-browser demonstration store: no credential is read back, logged or
 * rendered here, and the session token is persisted by `src/state/AuthContext.tsx` alone.
 *
 * @returns The sign-in section, in whichever of its four states the session puts it.
 */
export function LoginPage(): ReactElement {
  const headingId = useId();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { displayName, isAuthenticated, role, session, status } = useAuth();
  const { signIn, signOut } = useAuthDispatch();
  const { success: announceSuccess } = useToast();

  const [credentials, setCredentials] = useState<Credentials>(BLANK_CREDENTIALS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The token this page's own submission obtained, which is what tells its sign-in from a restored one. */
  const [obtainedToken, setObtainedToken] = useState<SessionToken | null>(null);

  const returnTo = intendedPath(searchParams.get(RETURN_TO_QUERY_KEY));
  // An action reports itself through the same status as the mount revalidation, so the submitting flag is
  // what keeps a submission from replacing the form the visitor is filling in with its own placeholder.
  const isRestoring = status === "loading" && !isSubmitting;
  const isSignedIn = isAuthenticated && !isRestoring;
  /**
   * Whether the path the guard preserved is one this visitor's role can open, which `canReachPath` in
   * `src/constants/routes.ts` decides: no role-to-section rule is restated in this file.
   */
  const isReturnToReachable = returnTo !== null && canReachPath(returnTo, role);
  /** Whether the panel states a refusal rather than a way on: the visitor is signed in and asked, through a
   * preserved path, for a page their role cannot reach. */
  const isRefused = isSignedIn && returnTo !== null && !isReturnToReachable;
  /**
   * The path a control on this screen may send the visitor to: the preserved one when their role can open
   * it, and the home their role does hold otherwise — so neither the signed-in state's continuation nor the
   * navigation this page performs after its own sign-in can land on a page the guard refuses.
   */
  const destination = isReturnToReachable ? returnTo : roleHomePath(role);
  // The account's name as the greeting uses it, empty until the identity projection resolves — and empty
  // again when that projection fails while the session itself stands, which is why both consumers below
  // leave the greeting out rather than render it with a name missing from it.
  const greeting = displayName.trim();
  const lede = isRefused
    ? ACCOUNT_ACCESS_COPY.BODY
    : isSignedIn
      ? greeting.length > 0
        ? signedInMessage(greeting)
        : undefined
      : ACCOUNT_COPY.SIGN_IN_SUBHEADING;

  // The title describes the route, which is this sign-in route in every one of the panel's states — the
  // panel's own heading below is what describes the state it is in, as `RegisterPage` does for its route.
  useDocumentTitle(documentTitle(PAGE_TITLES.SIGN_IN));

  /**
   * What has already been announced here, so the greeting and the continuation happen once per session
   * this page obtains: the provider re-renders for reasons of its own, and a repeated run would greet the
   * visitor twice and navigate again.
   */
  const announcedRef = useRef<SessionToken | null>(null);

  // The greeting names the account, and the account arrives with the session in the render that follows a
  // successful sign-in — so the outcome is announced and the visitor continues from that render rather
  // than from the click, at which the name is not yet known.
  useEffect(() => {
    if (obtainedToken === null || session?.token !== obtainedToken) return;
    if (announcedRef.current === obtainedToken) return;
    announcedRef.current = obtainedToken;
    if (greeting.length > 0) {
      announceSuccess(signedInMessage(greeting));
    }
    // The session is adopted before the visitor is moved on, so the guard they continue into cannot turn
    // them back out to a sign-in screen they have already filled in.
    void navigate(destination, { replace: true });
  }, [announceSuccess, destination, greeting, navigate, obtainedToken, session]);

  /** Writes one member, and clears the messages that were about the credentials as they stood. */
  const changeField =
    (member: keyof Credentials) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setCredentials((current) => ({ ...current, [member]: value }));
      setErrors((current) => clearFieldError(clearFieldError(current, member), FORM_ERROR_KEY));
      setFailure(null);
    };

  /**
   * Submits the credentials as typed: judged against the form's own rule first, so an empty pair is
   * reported on its controls without a request being made, and then by the store, which is the only party
   * that can say whether the pair matches an account.
   */
  const submit = async (): Promise<void> => {
    if (isSubmitting) return;
    const shapeErrors = validateSignIn(credentials);
    if (hasErrors(shapeErrors)) {
      setErrors(shapeErrors);
      setFailure(null);
      return;
    }
    setIsSubmitting(true);
    const answer = await signIn(credentials);
    setIsSubmitting(false);
    if (!answer.ok) {
      // Both halves of the refusal come from `src/lib/authService.ts`: the field map places a complaint on
      // the control the store named, and the canonical sentence is what the form-level alert shows. A
      // refused sign-in names no member, so the sentence belongs to the form rather than to a field.
      setFailure(answer.error);
      setErrors(toAuthFieldErrors(answer.error));
      return;
    }
    setErrors({});
    setFailure(null);
    setObtainedToken(answer.value.token);
  };

  const formMessage = errors[FORM_ERROR_KEY];

  const renderForm = (): ReactElement => (
    <>
      <form
        className="sp-auth__form"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          // Enter in either field submits through the form, so the keyboard path and the button run the
          // same handler; the browser's own validation stays off, because the rule is the library's.
          event.preventDefault();
          void submit();
        }}
      >
        {failure === null || formMessage === undefined ? null : (
          <div className="sp-auth__alert">
            <Alert tone="danger">{authErrorMessage(failure)}</Alert>
          </div>
        )}
        {SIGN_IN_FIELDS.map((field) => (
          <Input
            key={field.member}
            autoComplete={field.autoComplete}
            errors={errors}
            label={field.label}
            name={field.member}
            onChange={changeField(field.member)}
            required
            type={field.type}
            value={credentials[field.member]}
          />
        ))}
        <Button isBlock isLoading={isSubmitting} type="submit">
          {ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL}
        </Button>
      </form>
      <p className="sp-auth__switch">
        <Link
          className="sp-btn sp-btn--link"
          to={returnTo === null ? ROUTES.REGISTER : registerPath(returnTo)}
        >
          {ACCOUNT_COPY.GO_TO_REGISTER_LABEL}
        </Link>
      </p>
    </>
  );

  const renderRestoring = (): ReactElement => (
    <div aria-busy="true" className="sp-auth__form">
      <Skeleton lines={RESTORING_FIELD_LINES} variant="text" />
      <Skeleton variant="row" />
    </div>
  );

  const renderSignedIn = (): ReactElement => (
    <Link className="sp-btn sp-btn--primary sp-btn--block" to={destination}>
      {COMMON_ACTIONS.CONTINUE}
    </Link>
  );

  /**
   * Ends the session, so the visitor can sign in again as an account that holds the role the refused path
   * needs. The panel falls back to its form, which still carries the preserved path and honours it for
   * whichever role can reach it.
   */
  const leaveSession = (): void => {
    void signOut();
  };

  /**
   * The panel's refusal: the two ways this visitor can answer it, and neither of them the path they asked
   * for, because their role cannot reach it. The primary control goes to the home their role does hold and
   * the sign-out lets them arrive as an account that can open the refused page.
   */
  const renderRefused = (): ReactElement => (
    <ButtonGroup>
      <Link className="sp-btn sp-btn--primary" to={roleHomePath(role)}>
        {ACCOUNT_ACCESS_COPY.CONTINUE_LABEL}
      </Link>
      <Button variant="secondary" onClick={leaveSession}>
        {COMMON_ACTIONS.SIGN_OUT}
      </Button>
    </ButtonGroup>
  );

  /** What the panel holds: the placeholder, the refusal, the way on for a visitor who is already signed in,
   *  or the form. */
  const renderBody = (): ReactElement => {
    if (isRestoring) return renderRestoring();
    if (isRefused) return renderRefused();
    if (isSignedIn) return renderSignedIn();
    return renderForm();
  };

  return (
    // The route carries its own inline gutter: the shell's main region pads the block flow only, and
    // `sp-container` is where the stylesheets put the page's width and `--layout-gutter` — the same
    // wrapper, and the narrow measure, that `src/styles/layout.css` names the sign-in screens for.
    <div className="sp-container sp-container--narrow">
      <section aria-labelledby={headingId} className="sp-auth">
        <Card className="sp-auth__panel">
          <header className="sp-auth__header">
            <h1 className="sp-auth__title" id={headingId}>
              {isRefused
                ? ACCOUNT_ACCESS_COPY.HEADING
                : isSignedIn
                  ? PAGE_TITLES.ACCOUNT
                  : ACCOUNT_COPY.SIGN_IN_HEADING}
            </h1>
            {lede === undefined ? null : <p className="sp-auth__lede">{lede}</p>}
          </header>
          {renderBody()}
        </Card>
      </section>
    </div>
  );
}
