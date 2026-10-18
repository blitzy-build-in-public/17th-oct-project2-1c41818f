/**
 * Path: src/features/checkout/ShippingForm.tsx
 * Purpose: The shipping step: address entry or reuse of a saved address, with per-field validation
 * Lines: 534
 */

import { useEffect, useRef } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { RadioGroup, Select } from "@/components/ui/Select";
import { ACCOUNT_COPY, CHECKOUT_COPY, COMMON_ACTIONS } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { ADDRESS_FIELDS, SUPPORTED_COUNTRIES, type AddressFieldMember } from "@/constants/taxonomy";
import {
  addressLabel,
  buildAddressInput,
  defaultAddressFor,
  listAddresses,
} from "@/lib/customerService";
import { listShippingMethods } from "@/lib/pricingService";
import { useAuth } from "@/state/AuthContext";
import { useCheckout } from "@/state/CheckoutContext";
import { useAsync } from "@/state/hooks";
import type { Address, Session } from "@/types/account";
import type { PricedCart, ShippingMethod } from "@/types/commerce";
import type { CurrencyCode, MinorUnits, Result, SelectOption } from "@/types/common";
import { formatInteger, formatMoney } from "@/utils/format";

/*
 * Class contract, consumed by name because no file under `src/features/**` imports a stylesheet —
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/commerce.css` owns this step's
 * register: `sp-step__body` for the step's grid, `sp-address-form` for the field grid, `sp-address-picker`
 * with `__body` for the saved-address radios and the lines beneath them, and `sp-step__actions` for the row the
 * step's two controls share, which it places primary-first in markup and trailing from the medium stop. The
 * shipping methods and their frame are `src/styles/summary-panel.css`'s: `sp-summary__shipping` with
 * `sp-summary__method` and the `.sp-address-picker__option` frame they share. The rest comes from the shared
 * primitives, controls.css and layout.css.
 *
 * `ROUTES` is imported although `src/constants/routes.ts` sits outside this file's dependency set: the
 * step's return control links to the cart, §0.6.1 and §0.6.4 make that module the single home of every
 * route path, and `src/state/checkoutReducer.ts` documents the cart as reached by the link the step
 * renders rather than by a step transition. A path written here would give one route two homes.
 */

// Address fields ---------------------------------------------------------------------------------

/** One configured country's code and its label, keyed for the picker's address lines. */
const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map(
  SUPPORTED_COUNTRIES.map((country): [string, string] => [country.code, country.label]),
);

/** The patch each address field writes, keyed by the member its control binds to: a control's `name` is
 * both the key it reads its error by and the key it writes its value under, so the two cannot drift. */
const ADDRESS_PATCHES: Readonly<
  Record<AddressFieldMember, (value: string) => Partial<Record<AddressFieldMember, string>>>
> = {
  fullName: (value) => ({ fullName: value }),
  line1: (value) => ({ line1: value }),
  line2: (value) => ({ line2: value }),
  city: (value) => ({ city: value }),
  region: (value) => ({ region: value }),
  postalCode: (value) => ({ postalCode: value }),
  country: (value) => ({ country: value }),
  phone: (value) => ({ phone: value }),
};

/** The key lists the two loading states map over. The keys are positional on purpose: each placeholder is
 * the same decorative box, with no identity for a key to preserve. */
const ADDRESS_PLACEHOLDERS = ["first", "second"] as const;
const METHOD_PLACEHOLDERS = ["first", "second", "third"] as const;

/** The lists the reads fall back to before they answer, shared so every render hands its children the same
 * array rather than a fresh empty one. */
const NO_ADDRESSES: readonly Address[] = [];
const NO_METHODS: readonly ShippingMethod[] = [];

/** The mark between the parts of a delivery row and between a window's bounds. Both are notation rather
 * than wording, so neither is a sentence the content library owns. BLITZY [COPY]: the content library
 * holds no wording for a transit window, for its unit, or for a charge that costs nothing, so the day
 * units and the amount a waived charge reads as live here as notation too; keys belong in that library. */
const PART_SEPARATOR = " · ";
const WINDOW_SEPARATOR = "–";
const DAY_UNIT_SINGULAR = "day";
const DAY_UNIT_PLURAL = "days";
const FREE_DELIVERY_AMOUNT = "Free";

// Reading the domain -----------------------------------------------------------------------------

/** Whether a stored line carries something to show: neither absent nor blank. */
function isWritten(value: string): boolean {
  return value.trim().length > 0;
}

/** A saved address's own lines as one: its street, its locality and the country it names. */
function postalLineOf(address: Address): string {
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    countryNameOf(address.country),
  ]
    .filter(isWritten)
    .join(", ");
}

/** The country a stored code names, falling back to the code for one the configured set no longer holds. */
function countryNameOf(code: string): string {
  return COUNTRY_LABELS.get(code) ?? code;
}

/**
 * The transit window a method states, as a row reads it: `5–8 days`, `1 day`, or nothing for a method
 * collected the same day, whose own description already says so. The bounds are formatted through
 * `src/utils/format.ts` and no delivery date is computed here: the estimate an order shows is arithmetic
 * on its own placement date, which is the confirmation's concern.
 */
function transitWindowLabel(minDays: number, maxDays: number): string {
  if (maxDays <= 0) return "";
  const from = maxDays === minDays ? "" : `${formatInteger(minDays)}${WINDOW_SEPARATOR}`;
  const unit = maxDays === 1 ? DAY_UNIT_SINGULAR : DAY_UNIT_PLURAL;
  return `${from}${formatInteger(maxDays)} ${unit}`;
}

/**
 * The charge a method carries for the basket in the flow: what the price request quoted for the method the
 * shopper chose — where a free-delivery threshold and a free-delivery code are already applied — and the
 * method's own stored price for every row that is not the chosen one. No price or total is computed here,
 * and the pricing service reports no chosen method until one is chosen.
 */
function chargeMinorFor(method: ShippingMethod, quoted: PricedCart | null): MinorUnits {
  return quoted !== null && quoted.shippingMethodId === method.id
    ? quoted.shippingMinor
    : method.priceMinor;
}

/** The amount a row shows: the charge formatted for display, or the word a charge of nothing reads as. */
function amountLabel(chargeMinor: MinorUnits, currency: CurrencyCode | undefined): string {
  return chargeMinor === 0 ? FREE_DELIVERY_AMOUNT : formatMoney(chargeMinor, currency);
}

/** One method as a radio option: the option's label is the method's name, which the row itself restates
 * beside the description, the window and the charge. */
function methodOption(method: ShippingMethod): SelectOption {
  return { value: method.id, label: method.name };
}

/** The shipping values a saved address writes: `buildAddressInput`'s projection, member for member, with
 * the identifier the order records as the address it ships to. The address's own label is left out because
 * it names a book entry and the checkout's shipping values carry none. */
function addressPatchOf(address: Address) {
  const input = buildAddressInput(address);
  return {
    savedAddressId: address.id,
    fullName: input.fullName,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country,
    phone: input.phone,
  };
}

/** One account's address book, or the empty book a visitor holds: the seam refuses a sessionless request
 * with `401`, so there is nothing to ask on a visitor's behalf, and the guard also keeps the run total. */
function readAddressBook(
  session: Session | null,
  signal: AbortSignal,
): Promise<Result<readonly Address[]>> {
  return session === null
    ? Promise.resolve({ ok: true, value: NO_ADDRESSES })
    : listAddresses(session.customerId, { sessionToken: session.token, signal });
}

// The two option labels --------------------------------------------------------------------------

/** Everything {@link SavedAddressOptionLabel} renders from: the address the picker's option carries. */
interface SavedAddressOptionLabelProps {
  readonly address: Address;
}

/**
 * One saved address as its radio's label content: the lines shown beneath the radio, which are also the
 * radio's accessible name — the customer's own name for the address, then the address itself. Every word
 * comes from the stored record or the configured country list, so a row cannot describe an address the
 * book does not hold.
 *
 * @param props - The stored address to render.
 * @returns The lines, inside the element the sheet places beneath the radio.
 */
function SavedAddressOptionLabel({ address }: SavedAddressOptionLabelProps): ReactElement {
  return (
    <span className="sp-address-picker__body">
      <span>{addressLabel(address)}</span>
      <span>{postalLineOf(address)}</span>
    </span>
  );
}

/** Everything {@link DeliveryMethodOptionLabel} renders from: the method, and the priced basket its charge
 * is read from — `null` before a basket has been priced, and then every row states a stored price. */
interface DeliveryMethodOptionLabelProps {
  readonly method: ShippingMethod;
  readonly quoted: PricedCart | null;
}

/**
 * One delivery method as its radio's label content: what it is called, what it does, how long it takes and
 * what this basket pays for it, which together are the radio's accessible name. A row costing nothing says
 * so in words rather than as a zero amount, so a waived charge and a free method read alike.
 *
 * @param props - The method and the priced basket its charge comes from.
 * @returns The row's content, inside the label element `RadioGroup` renders around it.
 */
function DeliveryMethodOptionLabel({
  method,
  quoted,
}: DeliveryMethodOptionLabelProps): ReactElement {
  const window = transitWindowLabel(method.minDays, method.maxDays);
  return (
    <>
      {method.name}
      {PART_SEPARATOR}
      {method.description}
      {window.length === 0 ? null : `${PART_SEPARATOR}${window}`}
      {PART_SEPARATOR}
      {amountLabel(chargeMinorFor(method, quoted), quoted?.currency)}
    </>
  );
}

// The step ---------------------------------------------------------------------------------------

/**
 * The shipping step of the checkout: the contact email the order records, the delivery address, the saved
 * address it may be taken from, the delivery method, and the controls that move the flow on or back.
 *
 * The form renders the values the checkout already holds and writes every change straight back through its
 * actions, so it keeps no copy of them. The rules it appears to enforce are the flow's: the advance runs
 * the step's own validators in `src/state/CheckoutContext.tsx`, which judge the address through the one
 * address rule in `src/utils/validation.ts` — the rule the account address book reuses unchanged — and
 * record what they refuse as the field-keyed map this form places on its controls. A step that does not
 * pass therefore cannot be left, and returning to it finds every field as it was left.
 *
 * The saved-address picker appears only for a signed-in customer whose book has been read, and choosing an
 * address writes it into the fields, which stay editable: it is a starting point, never a bypass of the
 * rule. Each region renders the four states of `src/components/ui/Feedback.tsx` in order — a skeleton, an
 * empty state with one useful action, the shaped failure with its retry, and the loaded content.
 *
 * @returns The step, holding the contact, address and delivery-method controls and the step's own actions.
 */
export function ShippingForm(): ReactElement {
  const { values, errors, isSubmitting, snapshot, actions } = useCheckout();
  const { session, status: authStatus } = useAuth();
  const shipping = values.shipping;

  // The step's two reads: the signed-in customer's address book, and the configured delivery methods. Both
  // go through `useAsync`, so a superseded read is aborted rather than settling into an unmounted form, and
  // each deps list holds the inputs the request reads and nothing rebuilt on every render.
  const book = useAsync<readonly Address[]>(
    (signal: AbortSignal) => readAddressBook(session, signal),
    [session],
    { enabled: session !== null },
  );
  const methods = useAsync<ShippingMethod[]>(
    (signal: AbortSignal) => listShippingMethods({ signal }),
    [],
  );

  const savedAddresses = book.data ?? NO_ADDRESSES;
  const savedAddressOptions: readonly SelectOption[] = savedAddresses.map((address) => ({
    value: address.id,
    label: addressLabel(address),
  }));

  /** The first address field, which the empty state's one action sends the keyboard to. */
  const firstAddressFieldRef = useRef<HTMLInputElement | null>(null);
  /** Whether the form has already taken the address it starts from. */
  const seededRef = useRef(false);
  /** Whether a signed-in customer's book is still on its way: the seed waits for it rather than opening a
   * form without the address it should have opened with. */
  const isBookPending = session !== null && (book.status === "idle" || book.status === "loading");

  /**
   * Seeds the form from what the account and the configuration already know: the shopper's default saved
   * address, or the first their book holds when none is flagged, and otherwise the first configured
   * country — the value the country list opens on, and the reason its closed control can never show a
   * country the shipping values do not hold.
   *
   * Nothing is written over a value the shopper chose or typed. A visitor's identity may still arrive — a
   * stored session is revalidated on mount and a sign-in lands after the first render — so while there is
   * no session only the country is seeded and the gate stays open, which is what lets the address be
   * adopted the moment the session and the book are both in hand.
   */
  useEffect(() => {
    if (seededRef.current || authStatus === "loading" || isBookPending) return;
    if (session === null) {
      if (shipping.country.length === 0) {
        actions.updateValues({ shipping: { country: SUPPORTED_COUNTRIES[0].code } });
      }
      return;
    }
    seededRef.current = true;
    const claimed =
      shipping.savedAddressId !== null ||
      shipping.fullName.length > 0 ||
      shipping.line1.length > 0 ||
      shipping.city.length > 0;
    if (claimed) return;
    const preferred = defaultAddressFor(savedAddresses, "shipping") ?? savedAddresses[0];
    if (preferred !== undefined) {
      actions.updateValues({ shipping: addressPatchOf(preferred) });
      return;
    }
    if (shipping.country.length === 0) {
      actions.updateValues({ shipping: { country: SUPPORTED_COUNTRIES[0].code } });
    }
  }, [actions, authStatus, isBookPending, savedAddresses, session, shipping]);

  /** Writes the one member an address field carries, through that member's own writer. */
  const writeAddress =
    (member: AddressFieldMember) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      actions.updateValues({ shipping: ADDRESS_PATCHES[member](event.target.value) });
    };

  /** Writes the contact email the order records. */
  const writeEmail = (event: ChangeEvent<HTMLInputElement>): void => {
    actions.updateValues({ contact: { email: event.target.value } });
  };

  /** Adopts a saved address into the fields, keeping the identifier the order records; a value naming no
   * address of the book reports nothing. */
  const adoptSavedAddress = (value: string): void => {
    const address = savedAddresses.find((entry) => entry.id === value);
    if (address === undefined) return;
    actions.updateValues({ shipping: addressPatchOf(address) });
  };

  /** Starts an address of the shopper's own: every typed member is cleared while the country is kept,
   * because the list offers only configured countries and clearing it would leave the closed control
   * showing a country the values do not hold. */
  const startNewAddress = (): void => {
    actions.updateValues({
      shipping: {
        savedAddressId: null,
        fullName: "",
        line1: "",
        line2: "",
        city: "",
        region: "",
        postalCode: "",
        phone: "",
      },
    });
  };

  /** Chooses the delivery method, which is what clears the complaint about not having chosen one. */
  const chooseShippingMethod = (methodId: string): void => {
    actions.updateValues({ shipping: { shippingMethodId: methodId } });
  };

  /** Moves the flow on: the step's validators run in the checkout, which advances only when they pass. */
  const advance = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    actions.next();
  };

  /** Sends the keyboard to the first field of the address the empty state offers to add. */
  const focusAddressForm = (): void => {
    firstAddressFieldRef.current?.focus();
  };

  /** The saved-address region. A visitor sees none of it, and a failed read is reported above the form
   * rather than in place of it, because the address can still be typed. */
  const renderSavedAddresses = (): ReactElement | null => {
    if (session === null) return null;
    if (book.status === "error" && book.error !== null) {
      return (
        <Alert
          actionLabel={COMMON_ACTIONS.RETRY}
          error={book.error}
          onAction={book.reload}
          tone="danger"
        />
      );
    }
    if (book.status !== "success") {
      return (
        <div aria-busy="true" className="sp-address-picker">
          {ADDRESS_PLACEHOLDERS.map((placeholder) => (
            <Skeleton key={placeholder} variant="card" />
          ))}
        </div>
      );
    }
    if (savedAddresses.length === 0) {
      return <EmptyState headingLevel={3} onAction={focusAddressForm} surface="addresses" />;
    }
    return (
      <>
        <RadioGroup
          containerClassName="sp-address-picker"
          legend={CHECKOUT_COPY.SAVED_ADDRESS_LABEL}
          name="savedAddressId"
          onChange={adoptSavedAddress}
          optionClassName="sp-address-picker__option"
          options={savedAddressOptions}
          renderOptionLabel={(option) => {
            const address = savedAddresses.find((entry) => entry.id === option.value);
            return address === undefined ? (
              option.label
            ) : (
              <SavedAddressOptionLabel address={address} />
            );
          }}
          value={shipping.savedAddressId ?? ""}
        />
        {shipping.savedAddressId === null ? null : (
          <Button onClick={startNewAddress} type="button" variant="link">
            {CHECKOUT_COPY.USE_NEW_ADDRESS_LABEL}
          </Button>
        )}
      </>
    );
  };

  /** The delivery-method region: the configured methods, each stating what this basket pays for it. */
  const renderMethods = (): ReactElement => {
    if (methods.status === "error" && methods.error !== null) {
      return (
        <Alert
          actionLabel={COMMON_ACTIONS.RETRY}
          error={methods.error}
          onAction={methods.reload}
          tone="danger"
        />
      );
    }
    if (methods.status !== "success") {
      return (
        <div aria-busy="true" className="sp-summary__shipping">
          {METHOD_PLACEHOLDERS.map((placeholder) => (
            <Skeleton key={placeholder} variant="row" />
          ))}
        </div>
      );
    }
    const available = methods.data ?? NO_METHODS;
    return (
      <RadioGroup
        containerClassName="sp-summary__shipping"
        error={errors.shippingMethodId}
        legend={CHECKOUT_COPY.SHIPPING_METHOD_LEGEND}
        name="shippingMethodId"
        onChange={chooseShippingMethod}
        optionClassName="sp-summary__method"
        options={available.map(methodOption)}
        renderOptionLabel={(option) => {
          const method = available.find((entry) => entry.id === option.value);
          return method === undefined ? (
            option.label
          ) : (
            <DeliveryMethodOptionLabel method={method} quoted={snapshot} />
          );
        }}
        value={shipping.shippingMethodId}
      />
    );
  };

  return (
    <form className="sp-step__body" noValidate onSubmit={advance}>
      {renderSavedAddresses()}
      <div className="sp-address-form">
        <Input
          autoComplete="email"
          errors={errors}
          label={ACCOUNT_COPY.EMAIL_LABEL}
          name="email"
          onChange={writeEmail}
          required
          type="email"
          value={values.contact.email}
        />
        {ADDRESS_FIELDS.map((field, index) =>
          field.options === undefined ? (
            <Input
              key={field.member}
              ref={index === 0 ? firstAddressFieldRef : undefined}
              autoComplete={field.autoComplete}
              errors={errors}
              hint={field.hint}
              label={field.label}
              name={field.member}
              onChange={writeAddress(field.member)}
              required={field.required}
              type={field.type ?? "text"}
              value={shipping[field.member]}
            />
          ) : (
            <Select
              key={field.member}
              autoComplete={field.autoComplete}
              errors={errors}
              label={field.label}
              name={field.member}
              onChange={writeAddress(field.member)}
              options={field.options}
              required={field.required}
              value={shipping[field.member]}
            />
          ),
        )}
      </div>
      {renderMethods()}
      <div className="sp-step__actions">
        <Button isLoading={isSubmitting} type="submit">
          {CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL}
        </Button>
        <Link className="sp-btn sp-btn--secondary" to={ROUTES.CART}>
          {CHECKOUT_COPY.BACK_TO_CART_LABEL}
        </Link>
      </div>
    </form>
  );
}
