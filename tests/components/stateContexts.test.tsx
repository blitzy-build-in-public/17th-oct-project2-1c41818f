/**
 * Path: tests/components/stateContexts.test.tsx
 * Purpose: The catalogue, cart and toast contexts driven through their own hooks under the real providers
 * Lines: 544
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEYS, TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from "@/constants/config";
import { addedToCartMessage, lowStockLabel } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { API_PATHS } from "@/lib/apiClient";
import { useCart, useCartDispatch, useMiniCartOpen, useQuickAdd } from "@/state/CartContext";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { createInitialCartState, toCart } from "@/state/cartReducer";
import { useToast } from "@/state/ToastContext";
import type { FilterState } from "@/types/catalog";
import type { ToastMessage } from "@/types/common";
import type { Cart, CartLine } from "@/types/commerce";
import { readStored, writeStored } from "@/utils/storage";

import { FIXED_NOW, makeCartLine, makeProduct } from "../fixtures";
import { failNext, renderWithProviders, resetApiState, screen, waitFor } from "../testUtils";

/*
 * What this file proves, and how.
 *
 * The three contexts below are driven the way the product drives them: through their own hooks, inside the
 * providers `tests/testUtils.tsx` mounts, with the real catalogue service, the real cart reducer, the real store
 * and the real transport behind them. Each case renders a probe — a component that paints what a hook reports
 * and raises one call per control — interacts through the returned `user`, and asserts on what the probe
 * painted, so nothing here reads a context's internals and no service, reducer, context or data module is
 * replaced. The two seams a case needs are the ones the suites already use: an error state is armed at the API
 * seam with `failNext`, and the degraded store is `src/utils/storage.ts` meeting a browser that refuses its
 * writes.
 */

// Reading what a probe painted ---------------------------------------------------------------------

/** One value the probe painted, under the name a case reads it by. */
function Field({ name, value }: { readonly name: string; readonly value: string }): ReactElement {
  return <span data-testid={`field-${name}`}>{value}</span>;
}

/** The text a probe painted under one name. */
function painted(name: string): string {
  return screen.getByTestId(`field-${name}`).textContent ?? "";
}

/** Waits until the probe paints `value` under `name`, which is how a case reads a settled write. */
async function paints(name: string, value: string): Promise<void> {
  await waitFor(() => {
    expect(painted(name)).toBe(value);
  });
}

/** The control one call is raised through. */
function control(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

// The catalogue's query setters ---------------------------------------------------------------------

/** The tag the probe's tag control applies, which the canonical URL carries as written. */
const TAG = "featured";

/** What the catalogue probe's controls do, so a case names the call it raises. */
const CATALOG_CALL = {
  pageSize: "List 24 per page",
  price: "A range from 10.00 to 50.00",
  band: "The $50 to $100 band",
  otherBand: "The $25 to $50 band",
  clearBand: "No price band",
  rating: "Four stars and up",
  offScaleRating: "A rating off the five-star scale",
  inStock: "In stock only",
  tag: "The featured tag",
  reload: "Load the query again",
} as const;

/** A price range as a filter state holds it: `min-max` in minor units, an open side painted empty. */
function priceOf(filters: FilterState): string {
  const min = filters.minPriceMinor === null ? "" : String(filters.minPriceMinor);
  const max = filters.maxPriceMinor === null ? "" : String(filters.maxPriceMinor);
  return `${min}-${max}`;
}

/**
 * A catalogue consumer: it paints where the load stands, the address bar it is reading and the filter half of
 * the query, and raises one write per control through `useCatalogFilters()`.
 */
function CatalogProbe(): ReactElement {
  const catalogue = useCatalog();
  const filters = useCatalogFilters();
  const location = useLocation();

  const writes: readonly (readonly [string, () => void])[] = [
    [CATALOG_CALL.pageSize, () => filters.setPageSize(24)],
    [CATALOG_CALL.price, () => filters.setPriceRange(1_000, 5_000)],
    [CATALOG_CALL.band, () => filters.setFacetValue("price", "50-100")],
    [CATALOG_CALL.otherBand, () => filters.setFacetValue("price", "25-50")],
    [CATALOG_CALL.clearBand, () => filters.setFacetValue("price", null)],
    [CATALOG_CALL.rating, () => filters.setRating(4)],
    [CATALOG_CALL.offScaleRating, () => filters.setRating(9)],
    [CATALOG_CALL.inStock, () => filters.setInStockOnly(true)],
    [CATALOG_CALL.tag, () => filters.toggleTag(TAG)],
  ];

  return (
    <div>
      <Field name="status" value={catalogue.status} />
      <Field name="error" value={catalogue.error?.message ?? ""} />
      <Field name="location" value={`${location.pathname}${location.search}`} />
      <Field name="pageSize" value={String(filters.filters.pageSize)} />
      <Field name="price" value={priceOf(filters.filters)} />
      <Field
        name="rating"
        value={filters.filters.minRating === null ? "" : String(filters.filters.minRating)}
      />
      <Field name="inStock" value={String(filters.filters.inStockOnly)} />
      <Field name="tags" value={filters.filters.tags.join(",")} />
      <Field name="isDefault" value={String(filters.isDefault)} />
      {writes.map(([label, write]) => (
        <button key={label} type="button" onClick={write}>
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          catalogue.reload();
        }}
      >
        {CATALOG_CALL.reload}
      </button>
    </div>
  );
}

describe("the catalogue context's query setters", () => {
  beforeEach(resetApiState);

  it("writes the page size, a price range, the availability filter and a tag into the address bar", async () => {
    const { user } = renderWithProviders(<CatalogProbe />, { route: ROUTES.CATALOG });
    await paints("status", "success");

    await user.click(control(CATALOG_CALL.pageSize));
    await paints("pageSize", "24");
    await user.click(control(CATALOG_CALL.price));
    await paints("price", "1000-5000");
    await user.click(control(CATALOG_CALL.inStock));
    await paints("inStock", "true");
    await user.click(control(CATALOG_CALL.tag));
    await paints("tags", TAG);

    // One selection, one canonical address: the whole of it lives in the address bar and nowhere else.
    expect(painted("location")).toBe(
      `${ROUTES.CATALOG}?inStock=true&maxPrice=5000&minPrice=1000&pageSize=24&tags=${TAG}`,
    );
    expect(painted("isDefault")).toBe("false");
  });

  it("replaces a single-choice price band with the next one and clears it with none", async () => {
    const { user } = renderWithProviders(<CatalogProbe />, { route: ROUTES.CATALOG });
    await paints("status", "success");

    await user.click(control(CATALOG_CALL.band));
    await paints("price", "5000-9999");

    // A band holds one range at a time, so the second choice replaces the first rather than widening it.
    await user.click(control(CATALOG_CALL.otherBand));
    await paints("price", "2500-4999");

    await user.click(control(CATALOG_CALL.clearBand));
    await paints("price", "-");
  });

  it("accepts a rating on the scale and clears the star filter with one off it", async () => {
    const { user } = renderWithProviders(<CatalogProbe />, { route: ROUTES.CATALOG });
    await paints("status", "success");

    await user.click(control(CATALOG_CALL.rating));
    await paints("rating", "4");

    // A star floor nobody can reach is no filter rather than a filter matching nothing.
    await user.click(control(CATALOG_CALL.offScaleRating));
    await paints("rating", "");
  });

  it("holds the failure the facet request answered with and loads the query again on the retry", async () => {
    failNext({ path: API_PATHS.FACETS });
    const { user } = renderWithProviders(<CatalogProbe />, { route: ROUTES.CATALOG });

    await paints("status", "error");
    expect(painted("error").length).toBeGreaterThan(0);

    await user.click(control(CATALOG_CALL.reload));

    await paints("status", "success");
  });
});

// The cart's transitions ----------------------------------------------------------------------------

/** The product the cart's controls add, whose stock is the ceiling its line carries. */
const LAMP = makeProduct({ name: "Probe desk lamp", stockOnHand: 25 });

/** A product with nothing on hand, which builds no line at all. */
const KETTLE = makeProduct({ name: "Probe kettle", stockOnHand: 0 });

/** The code the probe applies, as the shopper typed it. */
const PROMO_CODE = "SAVE10";

/** How many distinct notifications a burst raises, one more than the queue holds. */
const NOTES_PER_BURST = TOAST_MAX_VISIBLE + 1;

/** The words the probe's repeated raise carries, which collapse into the one message standing. */
const NOTE = "The same note twice";

/** A success raise that overrides its heading and its duration, and the options it passes to do so. */
const OVERRIDDEN = {
  message: "Read for one and a half seconds",
  title: "Headed",
  durationMs: 1_500,
} as const;
const OVERRIDES = { title: OVERRIDDEN.title, durationMs: OVERRIDDEN.durationMs };

/** A failure left on its kind's own duration policy. */
const FAILURE = "A failure the queue keeps longer";

/** An id no notification of this queue can hold, which a dismissal is documented to leave it unchanged by. */
const NOT_HELD = 9_999;

/** The lines of a cart as the probe paints them. */
function describeLines(lines: readonly CartLine[]): string {
  return lines.map((line) => `${line.name}×${String(line.quantity)}`).join(" | ");
}

/** One queued message as the probe paints it: its kind, its heading, its words and its duration. */
function describeNote(message: ToastMessage): string {
  return `${message.kind}:${message.title ?? "-"}:${message.message}:${String(message.durationMs)}`;
}

/** The lines the cart has persisted, as one line, or the empty string when nothing usable is stored. */
function storedLines(): string {
  const cart = readStored<Cart | null>(STORAGE_KEYS.CART, null);
  return cart === null ? "" : describeLines(cart.lines);
}

/**
 * A cart and toast consumer: it paints the lines, the code applied, the drawer flag, the queue and what the two
 * reads below answered with, and raises one call per control.
 */
function StorefrontProbe(): ReactElement {
  const cart = useCart();
  const cartActions = useCartDispatch();
  const isDrawerOpen = useMiniCartOpen();
  const quickAdd = useQuickAdd();
  const toast = useToast();
  const [readCount, setReadCount] = useState<number | null>(null);
  const [heldId, setHeldId] = useState<number | null>(null);
  const firstLine = cart.lines[0];

  const calls: readonly (readonly [string, () => void])[] = [
    ["Add the lamp", () => cartActions.addItem(LAMP)],
    ["Add two more of the lamp", () => cartActions.addItem(LAMP, 2)],
    ["Fill the lamp line to its ceiling", () => cartActions.addItem(LAMP, LAMP.stockOnHand)],
    ["Add a product with nothing on hand", () => cartActions.addItem(KETTLE)],
    [
      "Raise the first line past its ceiling",
      () => {
        if (firstLine !== undefined) {
          cartActions.updateQuantity(firstLine.id, firstLine.maxQuantity + 5);
        }
      },
    ],
    [
      "Drop the first line",
      () => {
        if (firstLine !== undefined) cartActions.removeItem(firstLine.id);
      },
    ],
    ["Apply the promo code", () => cartActions.applyPromoCode(PROMO_CODE)],
    ["Empty the cart", () => cartActions.clearCart()],
    [
      "Read the lines",
      () => {
        setReadCount(cartActions.readLines().length);
      },
    ],
    ["Quick add the lamp", () => quickAdd(LAMP)],
    ["Open the drawer", () => cartActions.openMiniCart()],
    ["Close the drawer", () => cartActions.closeMiniCart()],
    ["Flip the drawer", () => cartActions.toggleMiniCart()],
    [
      "Raise the note",
      () => {
        setHeldId(toast.info(NOTE));
      },
    ],
    [
      `Raise ${String(NOTES_PER_BURST)} notes`,
      () => {
        for (let index = 1; index <= NOTES_PER_BURST; index += 1) {
          toast.info(`Note ${String(index)}`);
        }
      },
    ],
    ["Raise a note with its own duration", () => toast.success(OVERRIDDEN.message, OVERRIDES)],
    ["Raise a failure", () => toast.error(FAILURE)],
    [
      "Dismiss the newest note",
      () => {
        const newest = toast.toasts.at(-1);
        if (newest !== undefined) toast.dismiss(newest.id);
      },
    ],
    [
      "Drop a note nobody holds",
      () => {
        toast.dismiss(NOT_HELD);
      },
    ],
    [
      "Empty the notes",
      () => {
        toast.clear();
      },
    ],
  ];

  return (
    <div>
      <Field name="lines" value={describeLines(cart.lines)} />
      <Field name="promoCode" value={cart.promoCode ?? ""} />
      <Field name="drawerOpen" value={String(isDrawerOpen)} />
      <Field name="readCount" value={readCount === null ? "unread" : String(readCount)} />
      <Field name="heldId" value={heldId === null ? "" : String(heldId)} />
      <Field name="noteCount" value={String(toast.toasts.length)} />
      <Field name="notes" value={toast.toasts.map(describeNote).join(" | ")} />
      {calls.map(([label, call]) => (
        <button key={label} type="button" onClick={call}>
          {label}
        </button>
      ))}
    </div>
  );
}

describe("the cart context's transitions", () => {
  beforeEach(resetApiState);

  it("merges a repeated add, clamps a quantity to the line's ceiling and persists the cart it built", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Add the lamp"));
    await paints("lines", "Probe desk lamp×1");

    // A second add of the same product joins the line the cart already holds rather than standing beside it.
    await user.click(control("Add two more of the lamp"));
    await paints("lines", "Probe desk lamp×3");

    await user.click(control("Raise the first line past its ceiling"));
    await paints("lines", "Probe desk lamp×25");

    // The cart the shopper built is the cart the store holds, written through the product's own writer.
    await waitFor(() => {
      expect(storedLines()).toBe("Probe desk lamp×25");
    });

    // A product with nothing on hand builds no line, so this add changes nothing.
    await user.click(control("Add a product with nothing on hand"));
    expect(painted("lines")).toBe("Probe desk lamp×25");
  });

  it("restores the cart a previous document persisted, with the code that was applied to it", async () => {
    const stored = toCart(
      createInitialCartState({
        lines: [makeCartLine({ name: "Stored kettle", quantity: 2 })],
        promoCode: PROMO_CODE,
        updatedAt: FIXED_NOW,
      }),
    );
    expect(writeStored(STORAGE_KEYS.CART, stored)).toBe(true);

    renderWithProviders(<StorefrontProbe />);

    await paints("lines", "Stored kettle×2");
    expect(painted("promoCode")).toBe(PROMO_CODE);
    expect(painted("drawerOpen")).toBe("false");
    // A mount owes the store no write, so the cart this document read is still the one on disk.
    expect(storedLines()).toBe("Stored kettle×2");
  });

  it("drops one line, keeps the code beside the lines that stand, and empties both together", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Add the lamp"));
    await user.click(control("Apply the promo code"));
    await paints("promoCode", PROMO_CODE);

    await user.click(control("Drop the first line"));
    await paints("lines", "");
    // The code describes the cart rather than the line it was typed beside, so it stands.
    expect(painted("promoCode")).toBe(PROMO_CODE);

    await user.click(control("Add the lamp"));
    await paints("lines", "Probe desk lamp×1");
    await user.click(control("Empty the cart"));
    await paints("lines", "");
    await paints("promoCode", "");
  });

  it("reads the lines without subscribing the control to them, and keeps the drawer in its own context", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Read the lines"));
    await paints("readCount", "0");

    await user.click(control("Open the drawer"));
    await paints("drawerOpen", "true");
    await user.click(control("Flip the drawer"));
    await paints("drawerOpen", "false");
    await user.click(control("Flip the drawer"));
    await paints("drawerOpen", "true");
    await user.click(control("Close the drawer"));
    await paints("drawerOpen", "false");

    await user.click(control("Add the lamp"));
    await user.click(control("Read the lines"));
    await paints("readCount", "1");
    expect(painted("drawerOpen")).toBe("false");
  });

  it("keeps the cart in memory when the store refuses every write", async () => {
    const refused = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const { user } = renderWithProviders(<StorefrontProbe />);

      await user.click(control("Add the lamp"));
      await paints("lines", "Probe desk lamp×1");

      // Persistence is best-effort: the lines in memory are the product's source of truth, so a store that
      // takes nothing costs the shopper the cart on the next reload and nothing before it.
      expect(storedLines()).toBe("");
    } finally {
      refused.mockRestore();
    }
  });

  it("refuses a quick add of a line already at its ceiling, in the toast register", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Fill the lamp line to its ceiling"));
    await paints("lines", "Probe desk lamp×25");

    await user.click(control("Quick add the lamp"));
    await paints("notes", `error:-:${lowStockLabel(25)}:${String(TOAST_DURATION_MS.error)}`);
    expect(painted("lines")).toBe("Probe desk lamp×25");

    // The same control on a line with room adds a unit and reports the add instead of a refusal.
    await user.click(control("Empty the cart"));
    await user.click(control("Quick add the lamp"));
    await paints("lines", "Probe desk lamp×1");
    await waitFor(() => {
      expect(painted("notes")).toContain(addedToCartMessage(LAMP.name));
    });
  });
});

// The toast queue's policy --------------------------------------------------------------------------

describe("the toast queue's policy", () => {
  beforeEach(resetApiState);

  it("collapses a repeated raise into the message already standing", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Raise the note"));
    await paints("noteCount", "1");
    const held = painted("heldId");

    await user.click(control("Raise the note"));
    await paints("noteCount", "1");

    // The same message is not queued twice, and the second raise answers with the id already standing.
    expect(painted("heldId")).toBe(held);
    expect(painted("notes")).toBe(`info:-:${NOTE}:${String(TOAST_DURATION_MS.info)}`);
  });

  it("keeps the newest notifications when a burst raises more than the queue holds", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control(`Raise ${String(NOTES_PER_BURST)} notes`));

    await paints("noteCount", String(TOAST_MAX_VISIBLE));
    // The oldest went so that the newest stay visible, and the rest stand in the order they were raised.
    const expected = Array.from(
      { length: TOAST_MAX_VISIBLE },
      (_entry, index) => `info:-:Note ${String(index + 2)}:${String(TOAST_DURATION_MS.info)}`,
    ).join(" | ");
    expect(painted("notes")).toBe(expected);
  });

  it("carries the duration its kind declares, or the one its raise overrides it with", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Raise a note with its own duration"));
    await paints(
      "notes",
      `success:${OVERRIDDEN.title}:${OVERRIDDEN.message}:${String(OVERRIDDEN.durationMs)}`,
    );

    // A kind's own policy is what a message carries when its raise overrides nothing.
    await user.click(control("Raise a failure"));
    await paints("noteCount", "2");
    expect(painted("notes")).toContain(`error:-:${FAILURE}:${String(TOAST_DURATION_MS.error)}`);
  });

  it("removes the note a dismissal names and empties the queue, an empty queue changing nothing", async () => {
    const { user } = renderWithProviders(<StorefrontProbe />);

    await user.click(control("Raise the note"));
    await user.click(control("Raise a failure"));
    await paints("noteCount", "2");

    await user.click(control("Dismiss the newest note"));
    await paints("noteCount", "1");
    expect(painted("notes")).toContain(NOTE);

    await user.click(control("Empty the notes"));
    await paints("noteCount", "0");

    // A dismissal of something the queue does not hold changes nothing, and neither does clearing it twice.
    await user.click(control("Drop a note nobody holds"));
    await user.click(control("Empty the notes"));
    await paints("noteCount", "0");
  });
});
