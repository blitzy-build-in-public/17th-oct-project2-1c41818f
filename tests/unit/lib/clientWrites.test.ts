/**
 * Path: tests/unit/lib/clientWrites.test.ts
 * Purpose: The authority the durable record's folds keep: a record this browser wrote for an identity the seed holds cannot displace that identity's credential, role, email or identifier, and a registered account is left signing in
 * Lines: 322
 */

import { afterEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, STORAGE_KEYS } from "@/constants/config";
import {
  NO_CLIENT_WRITES,
  emailKey,
  mergeCredentials,
  mergeCustomers,
  type ClientWrites,
} from "@/data/clientWrites";
import { CREDENTIALS, CUSTOMERS } from "@/data/customers";
import { createSalesProDataSource } from "@/data/repositories";
import { API_PATHS, fillApiPath, getJson, patchJson, postJson } from "@/lib/apiClient";
import { registerDataSource } from "@/lib/mockServer";
import type {
  CredentialDigest,
  Customer,
  RegistrationResult,
  Role,
  Session,
} from "@/types/account";
import type { ReportDefinition } from "@/types/analytics";
import type { CustomerId } from "@/types/common";
import { createCredentialDigest, createSalt, verifyCredential } from "@/utils/strings";
import { writeStored } from "@/utils/storage";

import {
  expectRefusal,
  installFakeStorage,
  refusalOf,
  startSeam,
  valueOf,
} from "./mockServerHarness";

/** The password a page writes for a seeded email: chosen by whoever wrote the record, never documented. */
const CHOSEN_PASSWORD = "Chosen-password-1";

/** The identifier a record written by this browser names: the account the seed holds is identified by the
 * seed's own identifier, so a written record can only claim this one. */
const WRITTEN_ID = "cus_written_by_the_page" as CustomerId;

/** The address this case registers through the seam, so it is no account the seed holds. */
const REGISTERED_EMAIL = "written.record@salespro.test";

/** The seeded account an email names, read from the seed itself rather than restated here. */
function seededAccount(email: string): Customer {
  const account = CUSTOMERS.find((candidate) => candidate.email === email);
  if (account === undefined) throw new Error(`The seed holds no account at ${email}.`);
  return account;
}

/** The digest the product's own helpers produce for a password and an address: what a page can write. */
function digestFor(password: string, email: string): CredentialDigest {
  return createCredentialDigest(password, createSalt(email));
}

/** A durable record holding only the members the case crafts, so a fold is read against one write. */
function writesHolding(overrides: Partial<ClientWrites>): ClientWrites {
  return { ...NO_CLIENT_WRITES, ...overrides };
}

/** Writes one crafted record through the product's own writer, under the key the product declares. */
function writeRecord(record: ClientWrites): void {
  expect(writeStored(STORAGE_KEYS.CLIENT_WRITES, record)).toBe(true);
}

/** The store the case in progress installed, put back by the hook below in every outcome. */
let storage: ReturnType<typeof installFakeStorage> | null = null;

afterEach(() => {
  storage?.restore();
  storage = null;
});

describe("the credential map a document loads", () => {
  it.each<[string, string]>([
    ["the address as the seed spells it", DEMO_ACCOUNTS.ADMIN_EMAIL],
    ["the address in a different case", DEMO_ACCOUNTS.ADMIN_EMAIL.toUpperCase()],
  ])("keeps the seeded digest when a written record supplies one for %s", (_label, email) => {
    const administrator = seededAccount(DEMO_ACCOUNTS.ADMIN_EMAIL);
    const written = writesHolding({
      accounts: [
        {
          customer: { ...administrator, id: WRITTEN_ID, email },
          digest: digestFor(CHOSEN_PASSWORD, email),
        },
      ],
    });

    const entry = mergeCredentials(CREDENTIALS, written).get(emailKey(email));

    expect(entry?.customer.id).toBe(administrator.id);
    expect(verifyCredential(CHOSEN_PASSWORD, entry?.digest)).toBe(false);
    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, entry?.digest)).toBe(true);
  });

  it("takes a written account's own digest for an email the seed does not hold", () => {
    const written = writesHolding({
      accounts: [
        {
          customer: {
            ...seededAccount(DEMO_ACCOUNTS.CUSTOMER_EMAIL),
            id: WRITTEN_ID,
            email: REGISTERED_EMAIL,
          },
          digest: digestFor(CHOSEN_PASSWORD, REGISTERED_EMAIL),
        },
      ],
    });

    const entry = mergeCredentials(CREDENTIALS, written).get(emailKey(REGISTERED_EMAIL));

    expect(entry?.customer.id).toBe(WRITTEN_ID);
    expect(verifyCredential(CHOSEN_PASSWORD, entry?.digest)).toBe(true);
  });
});

describe("the account store a document loads", () => {
  const customer = seededAccount(DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  const administrator = seededAccount(DEMO_ACCOUNTS.ADMIN_EMAIL);

  it.each<[string, Partial<ClientWrites>, Customer]>([
    ["a profile edit", { profiles: [{ ...customer, role: "admin" }] }, customer],
    [
      "a registration record",
      {
        accounts: [
          {
            customer: { ...customer, role: "admin" },
            digest: digestFor(DEMO_ACCOUNTS.PASSWORD, customer.email),
          },
        ],
      },
      customer,
    ],
    [
      "a record naming the administrator's email under an identifier of its own",
      {
        accounts: [
          {
            customer: { ...administrator, id: WRITTEN_ID },
            digest: digestFor(CHOSEN_PASSWORD, administrator.email),
          },
        ],
      },
      administrator,
    ],
  ])(
    "keeps a seeded account's own role when the page writes %s for it",
    (_label, overrides, target) => {
      const merged = mergeCustomers(CUSTOMERS, writesHolding(overrides));
      const seededIds = new Set(CUSTOMERS.map((row) => row.id));

      expect(merged.filter((row) => row.role === "admin").map((row) => row.id)).toEqual(
        CUSTOMERS.filter((row) => row.role === "admin").map((row) => row.id),
      );
      expect(merged.find((row) => row.id === target.id)?.role).toBe(target.role);
      // A record naming a seeded account cannot introduce a second account beside it either.
      expect(merged.filter((row) => !seededIds.has(row.id))).toEqual([]);
    },
  );

  it.each<[Role]>([["admin"], ["guest"]])(
    "takes an account the seed does not hold with the role registration creates when a record claims %s",
    (claimed) => {
      const written: Customer = {
        ...customer,
        id: WRITTEN_ID,
        email: REGISTERED_EMAIL,
        firstName: "Edited",
        role: claimed,
      };

      const merged = mergeCustomers(CUSTOMERS, writesHolding({ profiles: [written] }));
      const appended = merged.find((row) => row.id === WRITTEN_ID);

      expect(merged.length).toBe(CUSTOMERS.length + 1);
      expect(appended?.role).toBe("customer");
      expect(appended?.firstName).toBe("Edited");
    },
  );

  it("honours the members the product's own writes change and nothing of the identity", () => {
    const edited: Customer = {
      ...customer,
      firstName: "Edited",
      email: REGISTERED_EMAIL,
      createdAt: "2000-01-01T00:00:00",
      loyaltyTier: "platinum",
      role: "admin",
    };

    const merged = mergeCustomers(CUSTOMERS, writesHolding({ profiles: [edited] }));
    const row = merged.find((entry) => entry.id === customer.id);

    expect(row?.firstName).toBe("Edited");
    expect(row?.email).toBe(customer.email);
    expect(row?.createdAt).toBe(customer.createdAt);
    expect(row?.loyaltyTier).toBe(customer.loyaltyTier);
    expect(row?.role).toBe("customer");
  });
});

describe("a durable record a page wrote for a seeded identity", () => {
  it("cannot displace the seeded administrator's password, which still signs in", async () => {
    const administrator = seededAccount(DEMO_ACCOUNTS.ADMIN_EMAIL);
    storage = installFakeStorage();
    writeRecord(
      writesHolding({
        accounts: [
          {
            customer: { ...administrator, id: WRITTEN_ID },
            digest: digestFor(CHOSEN_PASSWORD, administrator.email),
          },
        ],
      }),
    );
    startSeam();

    const chosen = await refusalOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: administrator.email,
        password: CHOSEN_PASSWORD,
      }),
    );
    expectRefusal(chosen, 401, "invalid-credentials");

    const documented = await valueOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: administrator.email,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect(documented.customerId).toBe(administrator.id);
    expect(documented.role).toBe("admin");
  });

  it("cannot raise a seeded customer's role, so every administrator surface refuses it", async () => {
    const customer = seededAccount(DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    const administrator = seededAccount(DEMO_ACCOUNTS.ADMIN_EMAIL);
    storage = installFakeStorage();
    writeRecord(writesHolding({ profiles: [{ ...customer, role: "admin" }] }));
    startSeam();

    const session = await valueOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: customer.email,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect(session.role).toBe("customer");

    const reports = await refusalOf(
      getJson<ReportDefinition[]>(API_PATHS.REPORT_DEFINITIONS, { sessionToken: session.token }),
    );
    expectRefusal(reports, 403, "forbidden");

    const profilePath = fillApiPath(API_PATHS.CUSTOMER_DETAIL, { id: administrator.id });
    const profile = await refusalOf(
      getJson<Customer>(profilePath, { sessionToken: session.token }),
    );
    expectRefusal(profile, 403, "forbidden");

    const edited = await refusalOf(
      patchJson<Customer>(
        profilePath,
        { firstName: "Intruder", lastName: "Intruder", phone: "", marketingOptIn: false },
        { sessionToken: session.token },
      ),
    );
    expectRefusal(edited, 403, "forbidden");
  });
});

describe("an account this browser registered", () => {
  it("signs in with its own credential and keeps its profile edits across a document load", async () => {
    storage = installFakeStorage();
    startSeam();

    const registered = await valueOf(
      postJson<RegistrationResult>(API_PATHS.AUTH_REGISTER, {
        email: REGISTERED_EMAIL,
        password: DEMO_ACCOUNTS.PASSWORD,
        firstName: "Quinn",
        lastName: "Written",
        marketingOptIn: false,
      }),
    );
    expect(registered.customer.role).toBe("customer");

    const path = fillApiPath(API_PATHS.CUSTOMER_DETAIL, { id: registered.customer.id });
    const edited = await valueOf(
      patchJson<Customer>(
        path,
        { firstName: "Edited", lastName: "Written", phone: "", marketingOptIn: true },
        { sessionToken: registered.session.token },
      ),
    );
    expect(edited.firstName).toBe("Edited");

    // The next document: an independent source over the same store, bound behind the seam.
    registerDataSource(createSalesProDataSource());
    const signedIn = await valueOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: REGISTERED_EMAIL,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect(signedIn.customerId).toBe(registered.customer.id);
    expect(signedIn.role).toBe("customer");

    const carried = await valueOf(getJson<Customer>(path, { sessionToken: signedIn.token }));
    expect(carried.firstName).toBe("Edited");
    expect(carried.marketingOptIn).toBe(true);
  });
});
