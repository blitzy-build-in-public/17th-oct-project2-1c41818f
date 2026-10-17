/**
 * Path: src/data/customers.ts
 * Purpose: The seeded customer base of 40 accounts including 2 administrators, with profiles, digests and addresses
 * Lines: 433
 */

import { DEMO_ACCOUNTS } from "@/constants/config";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { DATA_SEED, createSeededRandom, type SeededRandom } from "@/data/products";
import type { Address, CredentialDigest, Customer, LoyaltyTier, Role } from "@/types/account";
import type { IsoDateString, IsoDateTimeString } from "@/types/common";
import { addDays, parseIso, toIsoDate, toIsoDateTime } from "@/utils/dates";
import { addressId, createCredentialDigest, createSalt, customerId } from "@/utils/strings";

// Deterministic stream ---------------------------------------------------------------------------

/** This module's own stream, offset from the seed `src/data/products.ts` declares: no seeded
 *  collection inherits another's draws, and every one of them is reproducible on its own. */
const SEED = DATA_SEED + 1_013;

// Volume and dating ------------------------------------------------------------------------------

/** The accounts the base holds: thirty-eight shoppers and the two administrators the dashboard and
 *  the reports are gated to. `src/data/orders.ts` attributes sixty generated orders to them. */
const CUSTOMER_TOTAL = 40;
const ADMIN_TOTAL = 2;

/** The position of the second administrator: position zero is the account `src/constants/config.ts`
 *  documents, and this one is composed from the name pools like any other. */
const SECOND_ADMIN_INDEX = 2;

/** How many addresses one account's book holds: one, two or three. */
const ADDRESS_COUNT_MIN = 1;
const ADDRESS_COUNT_SPREAD = 2;

/** How far back an account is dated — four hundred days or more, so it predates the trailing year the
 *  order history covers — and how recently it last signed in, never in the future. */
const ACCOUNT_AGE_MIN_DAYS = 400;
const ACCOUNT_AGE_MAX_DAYS = 900;
const LAST_LOGIN_MIN_DAYS = 1;
const LAST_LOGIN_SPAN_DAYS = 150;

/** The share of accounts that agreed to be contacted; only the profile form reads it. */
const MARKETING_OPT_IN_CHANCE = 0.55;

// Account vocabulary -----------------------------------------------------------------------------

/** One account the seed is about to build: who it is, the address it signs in with, and its role. */
interface CustomerPlan {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
}

/** The name pools the generated accounts are composed from, written as lines of words split into
 *  entries rather than as twenty near-identical string literals. The two documented demonstration
 *  accounts name their own profiles, so no entry here is one the integration tests sign in with. */
const FIRST_NAMES = (
  "Aaron Bianca Caleb Delia Elena Farid Grace Hugo Imani Jonas Keira Liam " +
  "Maya Noah Omar Petra Quinn Rosa Samir Tessa Umar Vera Wesley Yara"
).split(" ");
const LAST_NAMES = (
  "Alvarez Brennan Castillo Duarte Ellison Fontaine Gallagher Hollis Ibrahim Jensen Kowalski " +
  "Lindqvist Moreau Novak Ortega Pereira Quintero Rossi Sandoval Thibault"
).split(" ");

/** How a family name advances with an account's position: seven places along the pool per step. Seven
 *  and twenty share no divisor and the given name cycles every twenty-four places, so no two of the
 *  forty positions draw the same pair. */
const LAST_NAME_STEP = 7;
const LAST_NAME_OFFSET = 3;

/** The reserved demonstration domains the generated accounts are written at, none of them routable;
 *  the second constant is the first suffix an address takes when two accounts spell it alike. */
const EMAIL_DOMAINS = ["salespro.test", "shopmail.test", "inbox.test"] as const;
const FIRST_EMAIL_SUFFIX = 2;

/** The tiers an account's seeded loyalty label walks, one position in four. The account at position
 *  one — the documented shopper — lands on silver, the tier the fixture builders give that customer;
 *  nothing in the product awards, spends or changes a tier. */
const LOYALTY_TIERS: readonly LoyaltyTier[] = ["bronze", "silver", "gold", "platinum"];

/** The two documented accounts in the order the seed builds them: the administrator
 *  `src/constants/config.ts` documents, then the shopper it documents. */
const DEMO_PROFILES: readonly CustomerPlan[] = [
  { email: DEMO_ACCOUNTS.ADMIN_EMAIL, firstName: "Priya", lastName: "Raman", role: "admin" },
  { email: DEMO_ACCOUNTS.CUSTOMER_EMAIL, firstName: "Dana", lastName: "Okafor", role: "customer" },
];

// Address vocabulary -----------------------------------------------------------------------------

/** The countries the address book offers, as `src/constants/taxonomy.ts` declares them, and the code
 *  a generated address names. */
type CountryEntry = (typeof SUPPORTED_COUNTRIES)[number];
type CountryCode = CountryEntry["code"];

/** One country's address vocabulary: the mould its postal codes are written in and the city-and-region
 *  pairs its addresses name.
 *
 *  The mould is spelled in `#` for a digit and `A` for an upper-case letter, filled by
 *  {@link postalCodeFor}, and reproduces the shape the country's `postalCodePattern` declares — so a
 *  seeded code satisfies the rule `src/utils/validation.ts` applies to a typed one. Keyed by the
 *  country-code union, so a country the taxonomy gains fails to compile here until it has a mould. */
interface CountryAddressPool {
  readonly postalMould: string;
  readonly places: readonly (readonly [city: string, region: string])[];
}

const COUNTRY_ADDRESS_POOLS: Readonly<Record<CountryCode, CountryAddressPool>> = {
  US: {
    postalMould: "#####",
    places: [
      ["Portland", "OR"],
      ["Austin", "TX"],
      ["Boston", "MA"],
    ],
  },
  CA: {
    postalMould: "A#A #A#",
    places: [
      ["Toronto", "ON"],
      ["Vancouver", "BC"],
    ],
  },
  GB: {
    postalMould: "AA# #AA",
    places: [
      ["London", "Greater London"],
      ["Bristol", "South West"],
    ],
  },
  AU: {
    postalMould: "####",
    places: [
      ["Sydney", "NSW"],
      ["Melbourne", "VIC"],
    ],
  },
  DE: {
    postalMould: "#####",
    places: [
      ["Berlin", "Berlin"],
      ["Munich", "Bavaria"],
    ],
  },
};

/** The dialling prefix each country's addresses record a phone number under, the characters a mould's
 *  letter placeholder is filled from, and the street names a first address line is written on — one
 *  pool for every country, because a street name is not what a postal rule judges. */
const COUNTRY_DIAL_CODES: Readonly<Record<CountryCode, string>> = {
  US: "+1",
  CA: "+1",
  GB: "+44",
  AU: "+61",
  DE: "+49",
};
const POSTAL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const STREET_NAMES = (
  "Beacon Street Alder Way Cedar Lane Dover Road Elm Court Fenwick Avenue Garden Row " +
  "Harbour Street Ivy Terrace Juniper Close Kingsway Larkspur Drive Maple Crescent " +
  "Norwood Lane Orchard Street Pine Walk"
).split(" ");

/** The numbers and chances the rest of an address's members are drawn with: the house numbers a first
 *  line runs between, the longest unit number a second line names, and the share of addresses with a
 *  second line at all. */
const HOUSE_NUMBER_MIN = 1;
const HOUSE_NUMBER_MAX = 240;
const UNIT_LABEL = "Apt";
const UNIT_NUMBER_MAX = 48;
const SECOND_LINE_CHANCE = 0.3;

/** The label the first address of every book carries, and the pool the further addresses draw from:
 *  one label each, never repeated, so the identifier built from the owner and the label is distinct
 *  within a book. */
const PRIMARY_ADDRESS_LABEL = "Home";
const OTHER_ADDRESS_LABELS = ["Work", "Studio", "Parents", "Weekend home", "Billing"] as const;

/** The share of a book's later addresses written outside the store's home country. The first address
 *  of every book is always home, so a checkout or an address book opens on the country the storefront
 *  is priced in, and a second entry is what exercises the rest of the country set. */
const FOREIGN_ADDRESS_CHANCE = 0.35;

// Address factory --------------------------------------------------------------------------------

/** The configured entry for a country code, or the store's home country when the code names none of
 *  them: the country set and its postal patterns are read from the taxonomy and never restated. */
function countryOf(code: string | undefined): CountryEntry {
  return SUPPORTED_COUNTRIES.find((entry) => entry.code === code) ?? SUPPORTED_COUNTRIES[0];
}

/** Writes a postal code in a country's mould: every `#` becomes a digit drawn from the account's own
 *  stream and every `A` an upper-case letter, everything else copied through. */
function postalCodeFor(mould: string, rand: SeededRandom): string {
  let code = "";
  for (const character of mould) {
    if (character === "#") code += String(rand.int(0, 9));
    else if (character === "A") code += POSTAL_LETTERS[rand.int(0, POSTAL_LETTERS.length - 1)];
    else code += character;
  }
  return code;
}

/** Builds the number an address records: the country's dialling prefix, an area code, the
 *  demonstration exchange and a four-digit line — ten to twelve digits, inside the range
 *  `src/utils/validation.ts` accepts. */
function phoneFor(countryCode: CountryCode, rand: SeededRandom): string {
  const line = String(rand.int(0, 9_999)).padStart(4, "0");
  return `${COUNTRY_DIAL_CODES[countryCode]} ${rand.int(20, 989)} 555 ${line}`;
}

/** Everything the shared address factory is given: whose address it is, what it is called, and the
 *  stream and country it is drawn with. */
export interface AddressSeedInput {
  /** The owning account: the identifier is keyed by it together with the label, so the same label is
   *  never the same address across two accounts. */
  readonly owner: string;
  /** The name the address book and the checkout show it under, unique within one account's book. */
  readonly label: string;
  /** The name the address is written to, as `src/data/orders.ts` passes a guest's. */
  readonly fullName: string;
  readonly random: SeededRandom;
  /** One of the supported country codes; the store's home country when none is named. */
  readonly countryCode?: string;
  /** The number to record; drawn from the country when the caller has none to pass. */
  readonly phone?: string;
  readonly isDefaultShipping?: boolean;
  readonly isDefaultBilling?: boolean;
}

/**
 * Builds one postal address of this product: the single home of the country set, the postal-code
 * shape, the label vocabulary and the phone shape, so the customer seed and the order seed that needs
 * a guest's delivery address both write one through it and neither grows a second generator.
 *
 * A caller passes the two default flags rather than leaving them to a rule here: which address of a
 * book is the default of each kind is the book's decision, and the book holds itself to one of each.
 *
 * @param input - The owner, label, name, stream and country the address is drawn from.
 * @returns The address, ready to be stored in the book of the account that owns it.
 */
export function buildAddress(input: AddressSeedInput): Address {
  const country = countryOf(input.countryCode);
  const pool = COUNTRY_ADDRESS_POOLS[country.code];
  const [city, region] = input.random.pick(pool.places);
  return {
    id: addressId(`${input.owner} ${input.label}`),
    label: input.label,
    fullName: input.fullName,
    line1:
      `${input.random.int(HOUSE_NUMBER_MIN, HOUSE_NUMBER_MAX)} ` + input.random.pick(STREET_NAMES),
    line2: input.random.chance(SECOND_LINE_CHANCE)
      ? `${UNIT_LABEL} ${input.random.int(1, UNIT_NUMBER_MAX)}`
      : "",
    city,
    region,
    country: country.code,
    postalCode: postalCodeFor(pool.postalMould, input.random),
    phone: input.phone ?? phoneFor(country.code, input.random),
    isDefaultShipping: input.isDefaultShipping ?? false,
    isDefaultBilling: input.isDefaultBilling ?? false,
  };
}

// Customer composition ---------------------------------------------------------------------------

/** The sign-in address one generated account is written at: its name in the `first.last@domain` shape
 *  every generated account shares, with a numeric suffix when a name would spell an address taken. */
function uniqueEmail(
  firstName: string,
  lastName: string,
  taken: ReadonlySet<string>,
  rand: SeededRandom,
): string {
  const local = `${firstName}.${lastName}`.toLowerCase();
  const domain = rand.pick(EMAIL_DOMAINS);
  let address = `${local}@${domain}`;
  for (let suffix = FIRST_EMAIL_SUFFIX; taken.has(address); suffix += 1) {
    address = `${local}${suffix}@${domain}`;
  }
  return address;
}

/** Plans the account at `index`: the two documented positions take their profiles from
 *  {@link DEMO_PROFILES} and every other account composes a name from the pools by its position.
 *  `taken` holds the addresses already handed out, so the plan's own is new. */
function planCustomer(index: number, taken: ReadonlySet<string>, rand: SeededRandom): CustomerPlan {
  const role: Role = index === 0 || index === SECOND_ADMIN_INDEX ? "admin" : "customer";
  const documented = DEMO_PROFILES.at(index);
  if (documented !== undefined) return documented;
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(index * LAST_NAME_STEP + LAST_NAME_OFFSET) % LAST_NAMES.length];
  return { email: uniqueEmail(firstName, lastName, taken, rand), firstName, lastName, role };
}

/** A day and time inside the window `day` bounds: only the day comes from the clock, and only once per
 *  build, so two builds on the same day are identical. */
function timestampOn(day: IsoDateString, rand: SeededRandom): IsoDateTimeString {
  const at = parseIso(day);
  if (at === null) throw new TypeError(`timestampOn requires an ISO day; received "${day}"`);
  at.setHours(rand.int(7, 21), rand.int(0, 59), 0, 0);
  return toIsoDateTime(at);
}

/** The salted digest a seeded account stores for the shared demonstration password.
 *
 *  Demonstration only, stated plainly: this is an in-browser account store, not a security boundary.
 *  The digest arithmetic is `src/utils/strings.ts`'s, and the salt is derived from the account's
 *  address rather than drawn at random, so the store is reproducible, a digest survives a rebuild
 *  unchanged and `verifyCredential` answers a sign-in from a fresh clone. No password is stored. */
function digestFor(email: string): CredentialDigest {
  return createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, createSalt(email));
}

/** Builds one account's address book: one to three addresses with distinct labels, the first written
 *  in the store's home country, and exactly one default shipping address and one default billing
 *  address — the first is the shipping default and the last the billing default, the same address when
 *  the book holds only one. That is what makes the one-default rule `src/lib/customerService.ts`
 *  enforces hold in the seed by construction rather than by a check afterwards. */
function buildAddressBook(plan: CustomerPlan, rand: SeededRandom): readonly Address[] {
  const count = ADDRESS_COUNT_MIN + rand.int(0, ADDRESS_COUNT_SPREAD);
  const labels = [PRIMARY_ADDRESS_LABEL, ...rand.pickMany(OTHER_ADDRESS_LABELS, count - 1)];
  const lastPosition = labels.length - 1;
  const fullName = `${plan.firstName} ${plan.lastName}`;
  return labels.map((label, position) => {
    const home = position === 0 || !rand.chance(FOREIGN_ADDRESS_CHANCE);
    return buildAddress({
      owner: plan.email,
      label,
      fullName,
      random: rand,
      countryCode: home ? undefined : rand.pick(SUPPORTED_COUNTRIES).code,
      isDefaultShipping: position === 0,
      isDefaultBilling: position === lastPosition,
    });
  });
}

// Seeded collections -----------------------------------------------------------------------------

/** One account's credentials as the account store holds them: the record itself and the digest its
 *  password is stored as. That digest is the only shape in which a credential leaves this module —
 *  it is what the sign-in check compares a submitted password against, and it reaches no page. */
export interface StoredCredential {
  readonly customer: Customer;
  readonly digest: CredentialDigest;
}

/** What one deterministic pass over the seeded accounts produces: the accounts, the addresses they
 *  own, and the credentials that verify them — built together, because an account's address
 *  references are written as its book is built. */
export interface CustomerSeed {
  readonly customers: readonly Customer[];
  readonly addresses: readonly Address[];
  readonly credentials: readonly StoredCredential[];
}

/**
 * Builds the entire seeded account base in one deterministic pass: the accounts of
 * {@link CUSTOMER_TOTAL}, each with the address book it owns and the credential that verifies the
 * shared demonstration password.
 *
 * Pure and re-callable: one seed stream and one reading of the clock reduced to a day, nothing else,
 * so two calls on the same day return deeply equal collections — the determinism
 * `tests/unit/lib/mockServer.test.ts` measures.
 *
 * @returns Every seeded account, every address they own, and the credentials that verify them.
 * @throws Error - When the built base would contradict an invariant of the seed: a count of
 *   administrators other than {@link ADMIN_TOTAL}, or two addresses sharing an identifier, both of
 *   which are programming errors in the pools above rather than conditions to absorb.
 */
export function buildCustomerSeed(): CustomerSeed {
  const rand = createSeededRandom(SEED);
  const anchorDay = toIsoDate(new Date());
  const taken = new Set<string>([DEMO_ACCOUNTS.ADMIN_EMAIL, DEMO_ACCOUNTS.CUSTOMER_EMAIL]);
  const customers: Customer[] = [];
  const addresses: Address[] = [];
  for (let index = 0; index < CUSTOMER_TOTAL; index += 1) {
    const plan = planCustomer(index, taken, rand);
    taken.add(plan.email);
    const book = buildAddressBook(plan, rand);
    addresses.push(...book);
    customers.push({
      id: customerId(plan.email),
      email: plan.email,
      firstName: plan.firstName,
      lastName: plan.lastName,
      phone: book[0].phone,
      role: plan.role,
      createdAt: timestampOn(
        addDays(anchorDay, -rand.int(ACCOUNT_AGE_MIN_DAYS, ACCOUNT_AGE_MAX_DAYS)),
        rand,
      ),
      lastLoginAt: timestampOn(
        addDays(anchorDay, -rand.int(LAST_LOGIN_MIN_DAYS, LAST_LOGIN_SPAN_DAYS)),
        rand,
      ),
      loyaltyTier: LOYALTY_TIERS[index % LOYALTY_TIERS.length],
      marketingOptIn: rand.chance(MARKETING_OPT_IN_CHANCE),
      addressIds: book.map((entry) => entry.id),
    });
  }
  if (customers.filter((entry) => entry.role === "admin").length !== ADMIN_TOTAL) {
    throw new Error(
      "The seeded accounts hold a number of administrators other than the configured one.",
    );
  }
  if (new Set(addresses.map((entry) => entry.id)).size !== addresses.length) {
    throw new Error("Two seeded addresses share an identifier.");
  }
  return {
    customers,
    addresses,
    credentials: customers.map((customer) => ({ customer, digest: digestFor(customer.email) })),
  };
}

/** The one pass every collection below is read from. */
const SEEDED: CustomerSeed = buildCustomerSeed();

/** The seeded accounts, exactly as {@link buildCustomerSeed} builds them: what the data source answers
 *  sign-in, registration, the profile, the address book and an administrator's reads from. */
export const CUSTOMERS: readonly Customer[] = SEEDED.customers;

/** The seeded address books, flat: every address a `Customer.addressIds` references, stored once and
 *  served for `GET /api/customers/:id/addresses`. */
export const ADDRESSES: readonly Address[] = SEEDED.addresses;

/** The seeded credentials, one per account, kept beside the accounts rather than inside them because
 *  no payload ever carries a digest. */
export const CREDENTIALS: readonly StoredCredential[] = SEEDED.credentials;
