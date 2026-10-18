/**
 * Path: src/App.tsx
 * Purpose: Provider composition in its required order, the error boundary and the layout around the routed content
 * Lines: 234
 */

import { Component } from "react";
import type { ErrorInfo, ReactElement, ReactNode } from "react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { ToastViewport } from "@/components/ui/Toast";
import { COMMON_ACTIONS, FEEDBACK_COPY } from "@/constants/content";
import { MiniCart } from "@/features/cart/MiniCart";
import { AppRoutes } from "@/Router";
import { AuthProvider } from "@/state/AuthContext";
import { CartProvider } from "@/state/CartContext";
import { CatalogProvider } from "@/state/CatalogContext";
import { CheckoutProvider } from "@/state/CheckoutContext";
import { ToastProvider } from "@/state/ToastContext";

/*
 * What this file owns, and what it deliberately leaves out.
 *
 * It is the client composition root, and it owns four things: the provider chain in the order the rest of the
 * product assumes, the error boundary around the routed content, the application shell around that, and the
 * two surfaces every route has to be able to raise — the toast viewport and the mini-cart drawer — mounted
 * once beside the shell rather than inside the routed region, so a notification and an open cart both survive
 * a route change. The order of the chain is fixed and is not a matter of taste: the toast provider is
 * outermost because every other provider and every page may raise a notification, and the catalogue, cart and
 * checkout providers sit inside the authentication provider because each of them reads the session it owns.
 *
 * Nothing here reads, mirrors, copies or writes another provider's state. The one handoff the product
 * defines — a placed order clearing the cart it was priced from — is `src/state/CheckoutContext.tsx`'s own
 * dispatch through `src/state/CartContext.tsx`, and a second implementation of it here would be one question
 * about the cart answered in two places.
 *
 * No router is rendered here and no data source is bound here. `src/main.tsx` owns the application's
 * `BrowserRouter` and calls `registerDataSource` before the first render, and `tests/testUtils.tsx` supplies a
 * `MemoryRouter` and its own binding, so this file composes for whichever router sits above it and would throw
 * inside the other one if it declared its own. The consequence to keep in view while reading it: `App`
 * requires a router above it, because the shell, the mini-cart and the routed content all read the location.
 *
 * The boundary is the product's only operational surface besides the toast system, and its failure state is
 * the only screen this file renders. It sits inside the shell so a screen that cannot render leaves the
 * header, the footer and the navigation usable, and it recovers in place rather than by reloading: dropping
 * the failure it holds mounts the routed content again, because the failure state replaced that content
 * during the commit that failed. Its two ways out are that recovery and a return to the home page, and its
 * single diagnostic is development-only and confined to itself, because the product ships no logging,
 * reporting or monitoring service for a failure to be wired to.
 *
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so the two classes the failure state wears are consumed by name: `src/styles/layout.css` owns
 * `sp-container` and `sp-page`, the page geometry the not-found view uses for the same reason. Everything else
 * it renders arrives composed: the empty state's parts and the alert's register come from
 * `src/components/ui/Feedback.tsx`, and the controls they offer are that component's own, so no button class,
 * no colour, no length, no radius and no breakpoint of this file's own appears below.
 */

/**
 * The home path the failure state's one destination points at.
 *
 * It is written here rather than read from `src/constants/routes.ts`, which owns every other path in the
 * product, because that module is outside this file's dependency set: the composition root composes what
 * already exists, and the list of modules it may reach is fixed by the plan. It is the router's root, it is
 * the only path string in the tree outside its owner, and the link it feeds is a document-level one on
 * purpose — the way out of a screen that failed to render has to hold even when the application's own state
 * is what failed.
 */
const HOME_PATH = "/";

/** What {@link RouteErrorBoundary} holds while it renders the failure state. */
interface RouteErrorBoundaryState {
  /** The failure a routed child threw, or `null` while the routed content renders. */
  readonly error: Error | null;
}

/** Everything {@link RouteErrorBoundary} accepts. */
interface RouteErrorBoundaryProps {
  /** The routed content: `AppRoutes`, or any element a test mounts for the boundary to guard. */
  readonly children: ReactNode;
}

/** Everything {@link RouteFailure} accepts. */
interface RouteFailureProps {
  /** The message of the failure that was caught, rendered as the alert's text. */
  readonly message: string;
  /** Clears the boundary's failure, which mounts the routed content again. */
  readonly onRetry: () => void;
}

/**
 * The state a screen shows when the routed content could not render.
 *
 * Two controls, one the recovery and the other the way back, and no third: the empty state offers the
 * destination, a document-level link to the router's root that holds however the render failed, and the alert
 * offers the recovery in place, which mounts the routed content again without a page reload. The wording and
 * the labels are the content library's — the empty state renders the boundary's own neutral pair when no
 * surface is named — so no sentence about a failure is written here, and neither control is written as markup:
 * both are the primitives' own.
 *
 * @param props.message - The caught failure's message; see {@link RouteFailureProps}.
 * @param props.onRetry - Clears the failure so the routed content mounts again.
 * @returns The failure state: the explanation, the way back, the message and the recovery.
 */
function RouteFailure({ message, onRetry }: RouteFailureProps): ReactElement {
  return (
    <div className="sp-container">
      <div className="sp-page">
        {/* The explanation and the way back. `headingLevel={1}` because a screen that could not render
            leaves this as the page's principal content, and the destination is a document-level link so it
            holds however the render failed. */}
        <EmptyState
          actionHref={HOME_PATH}
          actionLabel={FEEDBACK_COPY.ERROR_BOUNDARY_HOME_LABEL}
          headingLevel={1}
        />
        {/* The failure's own register and the recovery beside it. The body is the caught message, which is
            the only detail the boundary has and the reason a reader can act without opening the console. */}
        <Alert actionLabel={COMMON_ACTIONS.RETRY} onAction={onRetry} tone="danger">
          {message}
        </Alert>
      </div>
    </div>
  );
}

/**
 * Catches a failure in the routed content and renders the failure state in its place.
 *
 * A class, and deliberately so: React's boundary contract is class-only — `getDerivedStateFromError` decides
 * what the next render shows and `componentDidCatch` is the side effect beside it — and a class is the shape
 * that keeps the failure in state rather than in a ref read during render. Because the failure state replaces
 * only the routed content, the shell stays mounted, so the visitor keeps the header, the footer and every
 * navigation control while the screen they asked for is replaced by one they can recover from.
 *
 * @returns The routed content, or the failure state once a child has thrown.
 */
class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  /** Nothing has failed until a routed child throws. */
  state: RouteErrorBoundaryState = { error: null };

  /**
   * Records the failure for the render that follows, which is what makes React abandon the subtree that threw
   * and render the failure state in its place.
   *
   * @param error - What the routed subtree threw. Only its `message` is rendered, so a thrown value that is
   *   not an `Error` costs the failure state a generic sentence rather than the page.
   * @returns The state the boundary replaces its own with.
   */
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  /**
   * The diagnostic beside the state change: a development-only console report that keeps a failed render
   * readable while the product is being worked on. It is guarded rather than omitted because the component
   * stack a developer needs exists here and nowhere else, and nothing is hidden by leaving it out of the
   * shipped build, since the failure the visitor needs is on screen either way.
   *
   * @param error - The failure that was caught.
   * @param info - React's own record of it, whose component stack is the part worth printing.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("SalesPro: the routed content failed to render.", error, info.componentStack);
    }
  }

  /**
   * The recovery: dropping the failure mounts the routed content again.
   *
   * A field and not a method, so the alert receives one stable callback — this boundary is mounted for the
   * application's whole life, and a fresh function per render would hand the alert a new prop every commit.
   */
  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return <RouteFailure message={error.message} onRetry={this.handleRetry} />;
  }
}

/**
 * The application: the provider chain, the shell, the boundary and the two surfaces mounted outside the
 * routed region.
 *
 * What it renders, and why in this shape. The five providers, nested in the order the rest of the product
 * assumes. Inside them the application shell, so every route renders within one header, one footer and one
 * navigation. Inside the shell's content region the boundary, and inside the boundary the route table — the
 * boundary is inside the shell on purpose, because that is what leaves the navigation usable when a screen
 * fails. Beside the shell, and therefore outside the routed region, the mini-cart drawer and the toast
 * viewport: both have to outlive a route change — a notification raised on the catalogue is still there after
 * a move to the cart, and the cart the header's badge opened stays open through one — which is only true of a
 * subtree the router does not unmount.
 *
 * No props and no state of its own: every value below belongs to the provider that owns it, and this file
 * supplies no option to any of them. Mount it inside a router — `src/main.tsx` mounts it in the application's
 * `BrowserRouter`, and `tests/testUtils.tsx` in a `MemoryRouter` — and do not bind a data source here, which
 * is `src/main.tsx`'s call to `registerDataSource` made before this renders.
 *
 * @returns The composed application.
 */
export function App(): ReactElement {
  return (
    <ToastProvider>
      <AuthProvider>
        <CatalogProvider>
          <CartProvider>
            <CheckoutProvider>
              {/* The shell wraps the boundary rather than the other way round, so a failed screen keeps the
                  header, the footer and the navigation it is recovered from. `AppLayout` owns the
                  administrator sidebar branch, the skip link and the document's one `<main>` region. */}
              <AppLayout>
                <RouteErrorBoundary>
                  <AppRoutes />
                </RouteErrorBoundary>
              </AppLayout>
              {/* Beside the shell for the reason stated above, and inside every provider that has to serve
                  them: the drawer reads the cart context and the viewport the toast context. */}
              <MiniCart />
              <ToastViewport />
            </CheckoutProvider>
          </CartProvider>
        </CatalogProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
