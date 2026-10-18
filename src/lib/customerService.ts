/**
 * Path: src/lib/customerService.ts
 * Purpose: Profile updates and the address-book rules, including at most one default of each kind
 * Lines: 416
 */

import { FEEDBACK_COPY } from "@/constants/content";
import {
  API_ERROR_CODES,
  API_PATHS,
  deleteJson,
  failure,
  fillApiPath,
  getJson,
  patchJson,
  postJson,
} from "@/lib/apiClient";
import type {
  Address,
  AddressInput,
  AddressKind,
  Customer,
  DefaultAddressRequest,
  ProfileUpdateInput,
} from "@/types/account";
import type {
  AddressId,
  ApiError,
  ApiRequestOptions,
  CustomerId,
  FieldErrors,
  Result,
} from "@/types/common";
import { normaliseWhitespace } from "@/utils/strings";
import {
  FORM_ERROR_KEY,
  fieldErrorsFromApiError,
  hasErrors,
  validateAddress,
  validateProfileUpdate,
} from "@/utils/validation";

/**
 * One account's profile and address book: the reads and writes a signed-in customer's own record is
 * reached through, and the address rules that keep a book valid.
 *
 * Three boundaries hold here. The default-flag rules live in `src/utils/accountRules.ts`, which both
 * this layer and the data layer may read, and are published by this module: no component sets a
 * default flag, clears a competing one, or decides which address inherits a flag after a removal, so
 * `src/data/repositories.ts` composes the published rules to answer the address endpoints and
 * `src/features/account/AddressBookPage.tsx` only renders their result. Authorisation belongs to the
 * seam: `src/lib/mockServer.ts` resolves the caller's session and refuses a record the session
 * neither owns nor administrates, so this module decides no ownership and keeps no session state of
 * its own. Failures are values: each method resolves a `Result` carrying the seam's own `code` and
 * `field`, so a form marks the control that caused a refusal without wrapping a call in a
 * `try`/`catch`.
 */

// What a caller forwards --------------------------------------------------------------------------

/**
 * What a caller may hand a request besides the values the method already takes: the session token
 * the seam resolves the caller's session from, and the abort signal that cancels a read a newer one
 * supersedes.
 *
 * Both members are `ApiRequestOptions`'s own, taken from it so no second shape is declared for them,
 * and neither is decided here. The token comes from the session `src/state/AuthContext.tsx` holds and
 * is required for every one of these endpoints, because the seam refuses a request that carries no
 * session with `401` and one that names another account with `403`; the signal is the one
 * `src/state/hooks.ts`'s `useAsync` passes to a run. This module therefore decides no ownership and
 * remembers no session: it forwards what the caller holds and reports the seam's answer, so two
 * callers may pass two tokens and nothing here is shared between them.
 */
export type CustomerRequestOptions = Pick<ApiRequestOptions, "sessionToken" | "signal">;

// A body refused before it was sent ---------------------------------------------------------------

/**
 * Shapes the refusal of a body whose rule reported errors, asking the seam for it rather than writing
 * a status and a code here: the vocabulary's field-rule code, at the status it answers with, is the
 * same `422` the seam answers the same body with, so a form cannot tell a local refusal from a server
 * one.
 *
 * The first field a validator's map holds is the control to mark and its message the sentence to
 * show; the map a validator returns holds no empty message, so the fallbacks below — the form key for
 * a map with no field at all and the neutral sentence for one with no message — are unreachable from
 * a rule of `src/utils/validation.ts` and exist so the refusal is total rather than conditional. The
 * seam re-validates every body it is sent, so this refusal is a courtesy that saves a round trip
 * rather than the control.
 *
 * @param errors - The field-keyed map a rule returned.
 * @returns The refusal, ready to resolve in place of a request.
 */
function invalidInput(errors: FieldErrors): Result<never> {
  const [field, message] = Object.entries(errors)[0] ?? [
    FORM_ERROR_KEY,
    FEEDBACK_COPY.ERROR_STATE_BODY,
  ];
  return failure(API_ERROR_CODES.VALIDATION_FAILED, message, field);
}

// Profile -----------------------------------------------------------------------------------------

/**
 * Reads one account's record: the email that identifies it, the two names, the phone number, the
 * role and loyalty label, the timestamps, the marketing choice and the references to its addresses.
 *
 * @param id - The account to read, which a caller takes from the session's `customerId`. The seam
 *   answers `403` unless that session owns the id or holds the administrator role, and `401` when the
 *   request carries no session at all.
 * @param options - The session token and abort signal to forward.
 * @returns The account, or the shaped failure; never a rejection.
 */
export function getProfile(
  id: CustomerId,
  options: CustomerRequestOptions = {},
): Promise<Result<Customer>> {
  return getJson<Customer>(fillApiPath(API_PATHS.CUSTOMER_DETAIL, { id }), options);
}

/**
 * Writes the editable members of one account's profile: the two names, the phone number — an empty
 * string clears it — and the marketing choice.
 *
 * The email, the role, the loyalty tier, the timestamps and the addresses are absent from the body
 * because they are not editable through this path: the email identifies the account, the role and
 * the timestamps are the data layer's, and an address moves through its own endpoints.
 *
 * The body is judged by the profile rule before it is sent — the same `validateProfileUpdate` the
 * seam runs over every submitted body — so a name left empty or a mistyped phone number is refused
 * with the control it belongs to rather than after a round trip.
 *
 * @param id - The account to update.
 * @param input - The members to write, in full: an update describes the whole profile.
 * @param options - The session token and abort signal to forward.
 * @returns The updated account, or the shaped failure.
 */
export async function updateProfile(
  id: CustomerId,
  input: ProfileUpdateInput,
  options: CustomerRequestOptions = {},
): Promise<Result<Customer>> {
  const errors = validateProfileUpdate(input);
  if (hasErrors(errors)) return invalidInput(errors);
  return patchJson<Customer, ProfileUpdateInput>(
    fillApiPath(API_PATHS.CUSTOMER_DETAIL, { id }),
    input,
    options,
  );
}

/**
 * The map a failed request becomes for a profile or address form: the failure's own message filed
 * under the `field` it names, or under `FORM_ERROR_KEY` when it names none, so a form renders a
 * seam-side `422` exactly as it renders a rule it ran itself.
 *
 * A delegation to `fieldErrorsFromApiError` in `src/utils/validation.ts`, which owns the mapping and
 * the neutral sentence a failure with no message falls back to. The caller keeps the `ApiError` for
 * the page-level error state and uses this map for the controls.
 *
 * @param error - The failure a method resolved.
 * @returns A one-entry map keyed by the offending field, or by the form key.
 */
export function toProfileFieldErrors(error: ApiError): FieldErrors {
  return fieldErrorsFromApiError(error);
}

/**
 * The name to greet a customer by and to show in the header, the profile and the order history: the
 * account's two name parts joined.
 *
 * The join goes through `normaliseWhitespace` from `src/utils/strings.ts`, so a name entered with
 * stray or repeated spacing renders single-spaced, and a blank second part leaves no trailing space
 * behind. A name holding no letter at all is returned as it was stored rather than replaced with a
 * placeholder, because a placeholder is a fact about a person that nobody recorded.
 *
 * @param customer - The account, or any record carrying the two name parts.
 * @returns The display name; an empty string for a record holding neither part, which the
 *   registration rule prevents.
 */
export function displayName(customer: Pick<Customer, "firstName" | "lastName">): string {
  return normaliseWhitespace(`${customer.firstName} ${customer.lastName}`);
}

// The address book --------------------------------------------------------------------------------

/**
 * Lists one account's addresses, in the order its book holds them, with each address's two default
 * flags as they stand.
 *
 * The endpoint answers an `Address[]` directly rather than a page, because a customer's address book
 * is a small fixed set: the address book, the checkout's saved-address picker and the
 * {@link defaultAddressFor} lookup all read the whole book rather than a window of it.
 *
 * @param id - The account whose book is read; the seam answers `403` for another account's.
 * @param options - The session token and abort signal to forward.
 * @returns The addresses, or the shaped failure.
 */
export function listAddresses(
  id: CustomerId,
  options: CustomerRequestOptions = {},
): Promise<Result<Address[]>> {
  return getJson<Address[]>(fillApiPath(API_PATHS.CUSTOMER_ADDRESSES, { id }), options);
}

/**
 * Adds an address to one account's book and returns the created record with the identifier the data
 * layer assigned.
 *
 * The new address is the default of neither kind: making it one is a separate call through
 * {@link setDefaultAddress}, so an address stays valid while its default status changes and a book
 * cannot end up with two defaults because a form set both on one submit. The body is judged by the
 * address rule before it is sent, so a half-filled address is refused with the control it belongs to.
 *
 * @param id - The account whose book grows.
 * @param input - The address as entered, without an identifier and without either default flag.
 * @param options - The session token and abort signal to forward.
 * @returns The created address, or the shaped failure.
 */
export async function addAddress(
  id: CustomerId,
  input: AddressInput,
  options: CustomerRequestOptions = {},
): Promise<Result<Address>> {
  const errors = validateAddressInput(input);
  if (hasErrors(errors)) return invalidInput(errors);
  return postJson<Address, AddressInput>(
    fillApiPath(API_PATHS.CUSTOMER_ADDRESSES, { id }),
    input,
    options,
  );
}

/**
 * Replaces an address's members, carrying every editable member so an update describes the whole
 * address — a field the customer cleared is cleared by the empty string it carries.
 *
 * The identifier and the two default flags are not part of a body and are left exactly as they
 * stand, so editing the address that currently holds a default does not move that default onto
 * another one.
 *
 * @param id - The account that owns the book.
 * @param addressId - The address to replace; the seam answers `404` when it names none of this
 *   account's addresses.
 * @param input - The members to write, in full.
 * @param options - The session token and abort signal to forward.
 * @returns The updated address, or the shaped failure.
 */
export async function updateAddress(
  id: CustomerId,
  addressId: AddressId,
  input: AddressInput,
  options: CustomerRequestOptions = {},
): Promise<Result<Address>> {
  const errors = validateAddressInput(input);
  if (hasErrors(errors)) return invalidInput(errors);
  return patchJson<Address, AddressInput>(
    fillApiPath(API_PATHS.CUSTOMER_ADDRESS, { id, addressId }),
    input,
    options,
  );
}

/**
 * Removes one address from a book.
 *
 * For each kind whose default the removed address held, the flag falls to the most recently added
 * address that remains — the rule `promoteDefaultAfterRemoval` in `src/utils/accountRules.ts`
 * applies, composed by the data layer that serves this endpoint, so no component decides the
 * successor. An address that held no default leaves the book's flags untouched.
 *
 * Confirming the removal belongs to the surface: `src/components/ui/Modal.tsx`'s `ConfirmDialog` asks
 * the customer, and this call deletes once they have agreed. It answers `204`, so the payload is
 * `void`.
 *
 * @param id - The account that owns the book.
 * @param addressId - The address to remove; `404` when it names none of this account's addresses.
 * @param options - The session token and abort signal to forward.
 * @returns Nothing on success, or the shaped failure.
 */
export function removeAddress(
  id: CustomerId,
  addressId: AddressId,
  options: CustomerRequestOptions = {},
): Promise<Result<void>> {
  return deleteJson<void>(fillApiPath(API_PATHS.CUSTOMER_ADDRESS, { id, addressId }), options);
}

/**
 * Makes one address the default of the kind asked for, clearing the previous default of that same
 * kind and leaving the other kind exactly as it stood.
 *
 * The two kinds are independent, which is what `applyDefaultAddressRule` in
 * `src/utils/accountRules.ts` enforces when the data layer applies it: an address may be the shipping
 * default, the billing default, both or neither, and an order whose customer has no billing default
 * is billed to its shipping address.
 *
 * @param id - The account that owns the book.
 * @param addressId - The address to nominate; `404` when it names none of this account's addresses.
 * @param kind - Which default to point at the address: `"shipping"` or `"billing"`.
 * @param options - The session token and abort signal to forward.
 * @returns The address that became the default, or the shaped failure.
 */
export function setDefaultAddress(
  id: CustomerId,
  addressId: AddressId,
  kind: AddressKind,
  options: CustomerRequestOptions = {},
): Promise<Result<Address>> {
  const request: DefaultAddressRequest = { kind };
  return postJson<Address, DefaultAddressRequest>(
    fillApiPath(API_PATHS.CUSTOMER_ADDRESS_DEFAULT, { id, addressId }),
    request,
    options,
  );
}

// The address rules -------------------------------------------------------------------------------

// The default-flag rules live in `src/utils/accountRules.ts`, which both this layer and the data layer
// may read, and are published here because every caller reaches the address book through this service:
// the data layer applies them when it answers the set-default and removal endpoints, and the address
// book reads their result. Each rule keeps its one home there.
export { applyDefaultAddressRule, promoteDefaultAfterRemoval } from "@/utils/accountRules";

/**
 * The address that is the default of `kind`, or `undefined` when the book holds none: the lookup the
 * checkout's shipping step preselects with and the address book marks its cards by.
 *
 * The first address carrying the flag wins, so a book that somehow held two of a kind — which
 * `applyDefaultAddressRule` in `src/utils/accountRules.ts` prevents — still answers with one rather
 * than with an arbitrary one of them.
 *
 * @param addresses - The book to search; the order it is held in decides between duplicates only.
 * @param kind - Which default to look for.
 * @returns That address, or `undefined`.
 */
export function defaultAddressFor(
  addresses: readonly Address[],
  kind: AddressKind,
): Address | undefined {
  return addresses.find((address) => isDefaultOf(address, kind));
}

/** Whether `address` is the default of `kind`: the exhaustive switch over the two kinds. */
function isDefaultOf(address: Address, kind: AddressKind): boolean {
  switch (kind) {
    case "shipping":
      return address.isDefaultShipping;
    case "billing":
      return address.isDefaultBilling;
  }
}

/**
 * The editable members of an address, in the shape the create and update bodies take, so a form is
 * populated by one projection and the identifier and the two default flags stay where they belong.
 *
 * Every member is carried, empty strings included, because an update describes the whole address:
 * a member the form does not populate would otherwise read as absent and be refused as missing.
 *
 * @param address - The stored address to edit.
 * @returns The body that re-submits it unchanged.
 */
export function buildAddressInput(address: Address): AddressInput {
  return {
    label: address.label,
    fullName: address.fullName,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone,
  };
}

/**
 * The name an address is shown under: the customer's own label when they gave one, and otherwise
 * the street line and city the address itself holds.
 *
 * No sentence is written here, which is why no copy key is involved: a labelled address shows the
 * customer's own words and an unlabelled one shows its own stored fields, so the fallback cannot
 * read as prose an author invented. `src/constants/content.ts` names what is done *to* an address —
 * `removeAddressLabel(addressLabel(address))` labels the removal control — rather than what one is
 * called, and the confirm dialog's title and body come from its account copy.
 *
 * @param address - The address to name.
 * @returns Its label, or its street line and city when it carries none.
 */
export function addressLabel(address: Address): string {
  const own = normaliseWhitespace(address.label);
  if (own.length > 0) return own;
  return [address.line1, address.city]
    .map(normaliseWhitespace)
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * The address rule, applied to a form's values: full name, line 1, city, region, postal code and
 * country required, the postal code judged against the pattern of the country named, the phone
 * judged only once it is typed, and the label optional.
 *
 * A thin delegation to `validateAddress` in `src/utils/validation.ts`, which the checkout's shipping
 * step reuses unchanged, so a delivery address and a saved one cannot disagree about what is valid
 * and this module writes no second rule and no second country list. The keys of the map returned are
 * exactly `AddressInput`'s members, so a form attaches each message to its own control.
 *
 * @param input - The address as a form holds it.
 * @returns The field-keyed error map; empty when the address may be submitted.
 */
export function validateAddressInput(input: AddressInput): FieldErrors {
  return validateAddress(input);
}
