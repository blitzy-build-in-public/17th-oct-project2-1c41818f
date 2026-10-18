/**
 * Path: tests/unit/lib/customerService.test.ts
 * Purpose: Profile reads and writes, the address-book rules including at most one default of each kind, and the address projections
 * Lines: 574
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { FEEDBACK_COPY, VALIDATION_MESSAGES, postalCodeFormatMessage } from "@/constants/content";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { createSalesProDataSource } from "@/data/repositories";
import { signIn } from "@/lib/authService";
import {
  addAddress,
  addressLabel,
  applyDefaultAddressRule,
  buildAddressInput,
  defaultAddressFor,
  displayName,
  getProfile,
  listAddresses,
  promoteDefaultAfterRemoval,
  removeAddress,
  setDefaultAddress,
  toProfileFieldErrors,
  updateAddress,
  updateProfile,
  validateAddressInput,
} from "@/lib/customerService";
import { failNext, registerDataSource, resetMockServer } from "@/lib/mockServer";
import { addressId, customerId } from "@/utils/strings";
import { FORM_ERROR_KEY } from "@/utils/validation";
import { makeAddress } from "../../fixtures";

import type { CustomerRequestOptions } from "@/lib/customerService";
import type { Address, AddressInput, Customer, ProfileUpdateInput } from "@/types/account";
import type { ApiError, CustomerId, Result } from "@/types/common";

// The service is exercised against the real seam and the seeded store, never a stand-in: every member
// reaches its endpoint through `src/lib/apiClient.ts`, which dispatches to the in-process route table,
// which reads the data source bound below and authorises the session `signIn` issued. Nothing is mocked,
// so each assertion measures what a screen receives — a `Result`, its payload and its failure's status,
// code and field — and never a call count. The account integration flow asserts what the rendered book
// shows; the rule cases below call the rules the module exports directly.

beforeEach(() => {
  resetMockServer();
  registerDataSource(createSalesProDataSource());
});

/** The other seeded account: the record and the book no shopper's session may reach. */
const ADMIN_ID = customerId(DEMO_ACCOUNTS.ADMIN_EMAIL);

/** An identifier no book holds: a literal because naming nothing is the whole purpose of the value. */
const ABSENT_ADDRESS = addressId("blitzy-address-no-book-holds");

/** The two kinds, each with its own flag and the other kind's, so a kind case never switches on it. */
const KINDS = [
  ["shipping", "isDefaultShipping", "isDefaultBilling"],
  ["billing", "isDefaultBilling", "isDefaultShipping"],
] as const;

/** What a successful call resolved with, asserted rather than assumed. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  if (!result.ok) throw new Error(`expected a payload, received the refusal ${result.error.code}`);
  return result.value;
}

/** The failure a refused call resolved with, reached for once a case has asserted that the call failed. */
function refusalOf<TValue>(result: Result<TValue>): ApiError {
  if (result.ok) throw new Error("expected a refusal, received a payload");
  return result.error;
}

/** The seeded shopper signed in through the real sign-in path — the only issuer the seam honours — as the
 * identifier the paths name and the option every request carries. */
async function shopper(): Promise<{ accountId: CustomerId; options: CustomerRequestOptions }> {
  const outcome = await signIn({
    email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    password: DEMO_ACCOUNTS.PASSWORD,
  });
  if (!outcome.ok) throw new Error(`the shopper could not sign in: ${outcome.error.code}`);
  return { accountId: outcome.value.customerId, options: { sessionToken: outcome.value.token } };
}

/** The profile body an update takes: the account's own members, since an update describes the whole record. */
function profileBody(
  profile: Customer,
  overrides: Partial<ProfileUpdateInput> = {},
): ProfileUpdateInput {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    marketingOptIn: profile.marketingOptIn,
    ...overrides,
  };
}

/** The body that re-submits a stored address unchanged, with the members a case is about overridden. */
function draftFrom(held: Address, overrides: Partial<AddressInput> = {}): AddressInput {
  return { ...buildAddressInput(held), ...overrides };
}

/** How many addresses of a book carry one flag: the quantity the rule holds at one. */
function countDefault(
  book: readonly Address[],
  flag: "isDefaultShipping" | "isDefaultBilling",
): number {
  return book.filter((address) => address[flag]).length;
}

/** The label of a country the taxonomy configures, which is what the postal-code message names. */
function countryLabel(code: string): string {
  const entry = SUPPORTED_COUNTRIES.find((country) => country.code === code);
  if (entry === undefined) throw new Error(`no configured country is named ${code}`);
  return entry.label;
}

/** Two addresses with the seeded shape, under identifiers this file chooses so what a rule compares is visible. */
function twoAddressBook(): Address[] {
  return [
    makeAddress({ id: addressId("rule-alpha"), isDefaultShipping: true, isDefaultBilling: false }),
    makeAddress({ id: addressId("rule-zulu"), isDefaultShipping: false, isDefaultBilling: true }),
  ];
}

/** Three addresses, the first holding both kinds and the other two holding none. */
function threeAddressBook(): Address[] {
  return [
    makeAddress({ id: addressId("rule-alpha"), isDefaultShipping: true, isDefaultBilling: true }),
    makeAddress({ id: addressId("rule-mike"), isDefaultShipping: false, isDefaultBilling: false }),
    makeAddress({ id: addressId("rule-zulu"), isDefaultShipping: false, isDefaultBilling: false }),
  ];
}

describe("the account a session names", () => {
  it("reads the account the session names, at the email that identifies it", async () => {
    const { accountId, options } = await shopper();

    const profile = valueOf(await getProfile(accountId, options));

    // The session's own claim is the identifier the record is read by, and the record answers for it.
    expect(profile.id).toBe(accountId);
    expect(profile).toMatchObject({ email: DEMO_ACCOUNTS.CUSTOMER_EMAIL, role: "customer" });
  });

  it("refuses a read carrying no session, and another account's record", async () => {
    const { accountId, options } = await shopper();

    const anonymous = refusalOf(await getProfile(accountId));
    expect(anonymous.status).toBe(401);
    expect(anonymous.code).toBe("unauthenticated");
    expect(anonymous.message).toBe(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    // Another account's identifier is refused as an absent one would be, so a response reveals nothing.
    const foreign = refusalOf(await getProfile(ADMIN_ID, options));
    expect(foreign).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("the profile write", () => {
  it("writes the editable members and answers the record the next read holds", async () => {
    const { accountId, options } = await shopper();
    const before = valueOf(await getProfile(accountId, options));
    const body = profileBody(before, {
      firstName: "Danielle",
      lastName: "Okafor-Reyes",
      phone: "+1 503 555 0199",
      marketingOptIn: !before.marketingOptIn,
    });

    const updated = valueOf(await updateProfile(accountId, body, options));

    expect(updated).toMatchObject(body);
    // The email identifies the record and the addresses are the data layer's, so neither is this path's.
    expect(updated).toMatchObject({ id: before.id, email: before.email });
    // The change survives a re-read, which is what the next screen is answered with.
    expect(valueOf(await getProfile(accountId, options))).toEqual(updated);
  });

  it.each([
    ["a blank first name", { firstName: "" }, "firstName", VALIDATION_MESSAGES.REQUIRED],
    ["a blank last name", { lastName: "   " }, "lastName", VALIDATION_MESSAGES.REQUIRED],
    ["a phone number that is not one", { phone: "12" }, "phone", VALIDATION_MESSAGES.PHONE_FORMAT],
  ] as const)(
    "refuses %s before a request is sent, naming the control it belongs to",
    async (_case, overrides, field, message) => {
      const { accountId, options } = await shopper();
      const before = valueOf(await getProfile(accountId, options));
      // Armed against the endpoint this call would otherwise reach: a round trip would answer the seam's
      // `data-source-unavailable` rather than the rule's code below.
      failNext({ routeId: "customers.update" });
      const body = profileBody(before, overrides);

      const refusal = refusalOf(await updateProfile(accountId, body, options));

      expect(refusal).toMatchObject({ status: 422, code: "validation-failed", field, message });
      // A write that was never sent leaves the stored record exactly as it stood.
      expect(valueOf(await getProfile(accountId, options))).toEqual(before);
    },
  );

  it("refuses a write naming another account, and one carrying no session", async () => {
    const { accountId, options } = await shopper();
    const body = profileBody(valueOf(await getProfile(accountId, options)));

    // A valid body is what reaches the ownership check, so this refusal is the seam's, not a rule's.
    const foreign = refusalOf(await updateProfile(ADMIN_ID, body, options));
    expect(foreign).toMatchObject({ status: 403, code: "forbidden" });
    const anonymous = refusalOf(await updateProfile(accountId, body));
    expect(anonymous).toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("files a failure under the control it names, and under the form key when it names none", async () => {
    const { accountId, options } = await shopper();
    const before = valueOf(await getProfile(accountId, options));

    const byField = refusalOf(
      await updateProfile(accountId, profileBody(before, { phone: "12" }), options),
    );
    expect(toProfileFieldErrors(byField)).toEqual({ phone: VALIDATION_MESSAGES.PHONE_FORMAT });

    // A session failure names no control at all, so its sentence belongs above the fields, not on one.
    const byForm = refusalOf(await getProfile(accountId));
    expect(toProfileFieldErrors(byForm)).toEqual({
      [FORM_ERROR_KEY]: FEEDBACK_COPY.SIGN_IN_REQUIRED,
    });
  });
});

describe("the address book", () => {
  it("lists the book in the order the account holds it, with one default of each kind", async () => {
    const { accountId, options } = await shopper();
    const profile = valueOf(await getProfile(accountId, options));

    const book = valueOf(await listAddresses(accountId, options));

    // The account's own references are the order its book is held in, so a sorted listing would differ.
    expect(book.map((address) => address.id)).toEqual([...profile.addressIds]);
    expect(book.length).toBeGreaterThan(1);
    expect(countDefault(book, "isDefaultShipping")).toBe(1);
    expect(countDefault(book, "isDefaultBilling")).toBe(1);
    // One address of each kind, and on the seeded book the two are different addresses.
    const shipping = defaultAddressFor(book, "shipping");
    const billing = defaultAddressFor(book, "billing");
    expect(shipping?.id).not.toBe(billing?.id);
  });

  it("refuses a book read carrying no session, and another account's book", async () => {
    const { accountId, options } = await shopper();

    const anonymous = refusalOf(await listAddresses(accountId));
    expect(anonymous).toMatchObject({ status: 401, code: "unauthenticated" });
    const foreign = refusalOf(await listAddresses(ADMIN_ID, options));
    expect(foreign).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("creates an address that is the default of neither kind on a book that holds both", async () => {
    const { accountId, options } = await shopper();
    const before = valueOf(await listAddresses(accountId, options));
    // A label the seeded book does not hold, so the identifier minted for it is new.
    const draft = draftFrom(before[0], { label: "Study" });

    const created = valueOf(await addAddress(accountId, draft, options));

    expect(created.id).toMatch(/^adr_/);
    expect(before.map((address) => address.id)).not.toContain(created.id);
    // The book holds a default of each kind, so the new address is neither: making it one is a separate
    // call, which is what keeps one submit from minting a second default of a kind.
    expect(created).toMatchObject({ ...draft, isDefaultShipping: false, isDefaultBilling: false });
    const after = valueOf(await listAddresses(accountId, options));
    // The book that stood before, then the one address the call created appended to it.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toEqual(created);
    expect(countDefault(after, "isDefaultShipping")).toBe(1);
    expect(countDefault(after, "isDefaultBilling")).toBe(1);
  });

  it.each([
    ["an address with no street line", { line1: "" }, "line1"],
    ["a postal code the country named does not use", { postalCode: "ABCDE" }, "postalCode"],
  ] as const)(
    "refuses %s before a request is sent, naming the control it belongs to",
    async (_case, overrides, field) => {
      const { accountId, options } = await shopper();
      const before = valueOf(await listAddresses(accountId, options));
      const held = before[0];
      // Premise: no configured country's postal pattern accepts five letters, so the code below breaks
      // whichever pattern the country its own address names declares.
      for (const country of SUPPORTED_COUNTRIES) {
        expect(new RegExp(country.postalCodePattern).test("ABCDE")).toBe(false);
      }
      failNext({ routeId: "addresses.create" });

      const refusal = refusalOf(await addAddress(accountId, draftFrom(held, overrides), options));

      // The message is the rule's own: the required sentence, or the country the code is judged against.
      const message =
        field === "postalCode"
          ? postalCodeFormatMessage(countryLabel(held.country))
          : VALIDATION_MESSAGES.REQUIRED;
      expect(refusal).toMatchObject({ status: 422, code: "validation-failed", field, message });
      // A refusal that never left the page holds no record: the book is the one that stood before it.
      expect(valueOf(await listAddresses(accountId, options))).toEqual(before);
    },
  );

  it("replaces the editable members of an address and leaves both flags where they stood", async () => {
    const { accountId, options } = await shopper();
    const before = valueOf(await listAddresses(accountId, options));
    const held = before[0];

    const edited = valueOf(
      await updateAddress(accountId, held.id, draftFrom(held, { city: "Salem" }), options),
    );

    expect(edited).toMatchObject({ id: held.id, city: "Salem" });
    // The identifier and the flags are not part of a body, so an edit cannot move a default on or off it.
    expect(edited.isDefaultShipping).toBe(held.isDefaultShipping);
    expect(edited.isDefaultBilling).toBe(held.isDefaultBilling);
    // Read back, the book is the one that stood before with that one entry replaced and none of them moved.
    const after = valueOf(await listAddresses(accountId, options));
    expect(after).toEqual(before.map((address) => (address.id === held.id ? edited : address)));
  });

  it("refuses an edit whose body its rule rejects, before a request is sent", async () => {
    const { accountId, options } = await shopper();
    const held = valueOf(await listAddresses(accountId, options))[0];
    // Armed against the endpoint the edit would otherwise reach, as the profile refusal is.
    failNext({ routeId: "addresses.update" });
    const body = draftFrom(held, { city: "" });

    const refusal = refusalOf(await updateAddress(accountId, held.id, body, options));

    expect(refusal).toMatchObject({ status: 422, code: "validation-failed", field: "city" });
    expect(refusal.message).toBe(VALIDATION_MESSAGES.REQUIRED);
  });

  it("answers 404 for an address the book does not hold, on every path that names one", async () => {
    const { accountId, options } = await shopper();
    const held = valueOf(await listAddresses(accountId, options))[0];

    const refusals = [
      refusalOf(await updateAddress(accountId, ABSENT_ADDRESS, draftFrom(held), options)),
      refusalOf(await removeAddress(accountId, ABSENT_ADDRESS, options)),
      refusalOf(await setDefaultAddress(accountId, ABSENT_ADDRESS, "shipping", options)),
    ];
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({ status: 404, code: "address-not-found" });
    }
  });

  it.each(KINDS)(
    "hands the %s default a removal took to the most recently added address that remains",
    async (_kind, flag, otherFlag) => {
      const { accountId, options } = await shopper();
      const before = valueOf(await listAddresses(accountId, options));
      const draft = draftFrom(before[0], { label: "Study" });
      const added = valueOf(await addAddress(accountId, draft, options));
      const removed = before.find((address) => address[flag]);
      if (removed === undefined) throw new Error(`the seeded book holds no ${flag} default`);
      // Premise: the address just added carries the greatest identifier of the book — its suffix follows
      // the seeded labels by code unit — so it is the successor the rule names.
      for (const address of before) expect(added.id > address.id).toBe(true);

      const removal = await removeAddress(accountId, removed.id, options);

      // Removing answers nothing at all, which is what the endpoint's `void` payload is.
      expect(removal.ok).toBe(true);
      expect(valueOf(removal)).toBeUndefined();
      const after = valueOf(await listAddresses(accountId, options));
      const successor = after.find((address) => address.id === added.id);
      expect(after.map((address) => address.id)).not.toContain(removed.id);
      expect(successor?.[flag]).toBe(true);
      // The two kinds are independent: one kind's promotion neither moves nor clears the other's.
      expect(successor?.[otherFlag]).toBe(false);
      expect(countDefault(after, flag)).toBe(1);
      expect(countDefault(after, otherFlag)).toBe(1);
      // The kind that lost nothing kept the address that already held it.
      const kept = before.find((address) => address[otherFlag]);
      expect(kept).toBeDefined();
      expect(after.find((address) => address.id === kept?.id)?.[otherFlag]).toBe(true);
    },
  );

  it("leaves every flag as it was when the address removed held no default", async () => {
    const { accountId, options } = await shopper();
    const before = valueOf(await listAddresses(accountId, options));
    const added = valueOf(
      await addAddress(accountId, draftFrom(before[0], { label: "Study" }), options),
    );

    const removal = await removeAddress(accountId, added.id, options);

    expect(removal.ok).toBe(true);
    // The address held neither kind, so nothing was promoted and the book's defaults did not move.
    expect(valueOf(await listAddresses(accountId, options))).toEqual(before);
  });

  it.each(KINDS)(
    "points the %s default at the named address, clearing that kind's competing flag only",
    async (kind, flag, otherFlag) => {
      const { accountId, options } = await shopper();
      const before = valueOf(await listAddresses(accountId, options));
      const previous = before.find((address) => address[flag]);
      const target = before.find((address) => !address[flag]);
      if (previous === undefined || target === undefined) {
        throw new Error(`the seeded book holds no un-flagged ${flag} address`);
      }
      const otherFlags = before.map((address) => address[otherFlag]);

      const nominated = valueOf(await setDefaultAddress(accountId, target.id, kind, options));

      expect(nominated.id).toBe(target.id);
      expect(nominated[flag]).toBe(true);
      const after = valueOf(await listAddresses(accountId, options));
      expect(after.find((address) => address.id === target.id)?.[flag]).toBe(true);
      // The address that held the kind gives it up; every flag of the other kind stands as it stood.
      expect(after.find((address) => address.id === previous.id)?.[flag]).toBe(false);
      expect(after.map((address) => address[otherFlag])).toEqual(otherFlags);
      expect(countDefault(after, flag)).toBe(1);
      expect(countDefault(after, otherFlag)).toBe(1);
    },
  );
});

describe("the address rules, called directly", () => {
  it("points a kind's default at the nominated address, clearing that kind only", () => {
    const book = twoAddressBook();
    const frozen = structuredClone(book);

    const nominated = applyDefaultAddressRule(book, book[1].id, "shipping");

    // A new array: the nominated address takes on both kinds, the other is left as the billing default.
    expect(nominated).not.toBe(book);
    expect(nominated).toMatchObject([
      { id: book[0].id, isDefaultShipping: false, isDefaultBilling: false },
      { id: book[1].id, isDefaultShipping: true, isDefaultBilling: true },
    ]);
    expect(countDefault(nominated, "isDefaultShipping")).toBe(1);
    expect(countDefault(nominated, "isDefaultBilling")).toBe(1);
    expect(book).toEqual(frozen);
  });

  it("carries an address over as the same object when its flag already holds what was asked", () => {
    const book = twoAddressBook();

    const again = applyDefaultAddressRule(book, book[0].id, "shipping");

    // The array is new but no flag was written, so a caller comparing references sees no change at all.
    expect(again).not.toBe(book);
    expect(again[0]).toBe(book[0]);
    expect(again[1]).toBe(book[1]);
  });

  it("leaves the book as it stands when the identifier names no address of it", () => {
    const book = twoAddressBook();

    const untouched = applyDefaultAddressRule(book, ABSENT_ADDRESS, "billing");

    // Naming an absent address is the data layer's `404`, not a rule that empties a default it cannot fill.
    expect(untouched).not.toBe(book);
    expect(untouched).toEqual(book);
    untouched.forEach((address, index) => expect(address).toBe(book[index]));
  });

  it("promotes each kind a removal took to the greatest identifier that remains", () => {
    const book = threeAddressBook();
    const frozen = structuredClone(book);

    const remaining = promoteDefaultAfterRemoval(book, book[0].id);

    expect(remaining.map((address) => address.id)).toEqual([
      addressId("rule-mike"),
      addressId("rule-zulu"),
    ]);
    // Both kinds fall to the greatest identifier, not to the address that happens to sit first.
    expect(remaining[1]).toMatchObject({ isDefaultShipping: true, isDefaultBilling: true });
    expect(remaining[0]).toMatchObject({ isDefaultShipping: false, isDefaultBilling: false });
    expect(book).toEqual(frozen);
  });

  it("leaves every flag as it was when the address removed held no default", () => {
    const book = threeAddressBook();

    const remaining = promoteDefaultAfterRemoval(book, book[1].id);

    expect(remaining).toEqual([book[0], book[2]]);
    expect(remaining[0]).toBe(book[0]);
    expect(remaining[1]).toBe(book[2]);
  });

  it("removes nothing and promotes nothing when the identifier names no address of the book", () => {
    const book = twoAddressBook();

    const untouched = promoteDefaultAfterRemoval(book, ABSENT_ADDRESS);

    expect(untouched).toEqual(book);
    untouched.forEach((address, index) => expect(address).toBe(book[index]));
  });

  it("promotes nothing when no address remains to carry the kind", () => {
    // An identifier that names no address removes nothing at all, and the only address of a one-address
    // book goes with it, leaving no successor to promote.
    const [sole] = threeAddressBook();
    expect(promoteDefaultAfterRemoval([], ABSENT_ADDRESS)).toEqual([]);
    expect(promoteDefaultAfterRemoval([sole], sole.id)).toEqual([]);
  });

  it("answers the address that is a kind's default, and nothing when the book holds none", () => {
    const book = twoAddressBook();

    expect(defaultAddressFor(book, "shipping")).toBe(book[0]);
    expect(defaultAddressFor(book, "billing")).toBe(book[1]);
    const neither = [makeAddress({ isDefaultShipping: false, isDefaultBilling: false })];
    expect(defaultAddressFor(neither, "shipping")).toBeUndefined();
    expect(defaultAddressFor(neither, "billing")).toBeUndefined();
    expect(defaultAddressFor([], "shipping")).toBeUndefined();
  });
});

describe("the address projections", () => {
  it("carries an address's editable members alone, and re-submits them unchanged", async () => {
    const { accountId, options } = await shopper();
    const held = valueOf(await listAddresses(accountId, options))[0];

    const body = buildAddressInput(held);

    // The identifier and the two default flags belong to the data layer, so the body carries the nine
    // editable members and nothing else: everything but the three members dropped here.
    const { id: _id, isDefaultShipping: _shipping, isDefaultBilling: _billing, ...editable } = held;
    expect(body).toEqual(editable);
    // Which is what makes it re-submittable: the update it populates answers the record as it stood.
    expect(valueOf(await updateAddress(accountId, held.id, body, options))).toEqual(held);
  });

  it.each([
    [{ label: "  Home  " }, "Home"],
    [{ label: "  ", line1: " 12 Beacon Street ", city: " Portland" }, "12 Beacon Street, Portland"],
    [{ label: "", line1: "  ", city: "Portland" }, "Portland"],
  ] as const)(
    "names an address by its label, else by its street line and city",
    (overrides, expected) => {
      // A labelled address shows the customer's own words and an unlabelled one its own stored fields, so
      // no sentence an author invented can stand where an address is named.
      expect(addressLabel(makeAddress(overrides))).toBe(expected);
    },
  );

  it.each([
    [{ firstName: "Dana", lastName: "Okafor" }, "Dana Okafor"],
    [{ firstName: "  Dana ", lastName: "  Okafor  " }, "Dana Okafor"],
    [{ firstName: "Dana", lastName: "" }, "Dana"],
    [{ firstName: "Dana", lastName: "   " }, "Dana"],
    [{ firstName: "", lastName: "" }, ""],
  ] as const)("joins %j into a single-spaced display name", (name, expected) => {
    // A blank second part leaves no trailing space, and a record holding neither part answers an empty
    // string rather than a placeholder nobody recorded.
    expect(displayName(name)).toBe(expected);
  });

  it.each([
    ["a complete address", {}, {}],
    ["a missing street line", { line1: "" }, { line1: VALIDATION_MESSAGES.REQUIRED }],
    ["a missing city", { city: "" }, { city: VALIDATION_MESSAGES.REQUIRED }],
    ["an address without its optional members", { label: "", line2: "", phone: "" }, {}],
  ] as const)("keys %s by the control it belongs to", (_case, overrides, expected) => {
    const draft: AddressInput = { ...draftFrom(makeAddress()), ...overrides };

    // The label, the second line and the phone are optional, so an address without them is submittable.
    expect(validateAddressInput(draft)).toEqual(expected);
  });
});
