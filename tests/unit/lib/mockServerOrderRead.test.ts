/**
 * Path: tests/unit/lib/mockServerOrderRead.test.ts
 * Purpose: The order read's authorisation: an account-less order answered to its placement credential or an administrator alone, and the same refusal a foreign order gets for everyone else
 * Lines: 74
 */

import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_CARD_NUMBERS } from "@/constants/config";
import { getJson, postJson } from "@/lib/apiClient";
import type { Session } from "@/types/account";
import type { Order } from "@/types/commerce";

import {
  expectRefusal,
  orderBody,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// The authorisation rule these cases prove: an order that names no account is answered to the credential it
// was placed with, or to an administrator, and every other caller gets the same `404` a foreign order gets,
// so a response cannot be read to learn whether an identifier exists. Each case drives the real seam over the
// seeded data source and binds its own source through the harness.

/** A row limit past the seeded order count, so a count reads the whole collection it is about. */
const ALL_ROWS = 10_000;

describe("order-detail authorisation", () => {
  it("answers an account-less order to its placement credential alone, and serves an administrator", async () => {
    // A seeded order that names no account is answered to an administrator; a caller that sent no session is
    // refused, and a signed-in customer is refused with the same `404` a foreign account-owned order answers,
    // so a response cannot be read to learn whether an identifier exists.
    const source = startSeam();
    const seeded = source.getRecentOrders(ALL_ROWS).find((order) => order.customerId === null);
    if (seeded === undefined) throw new Error("The seeded orders hold no account-less order.");
    const seededPath = `/api/orders/${seeded.id}`;
    expectRefusal(await refusalOf(getJson(seededPath)), 401, "unauthenticated");
    const shopper = await signInCustomer();
    expectRefusal(
      await refusalOf(getJson(seededPath, { sessionToken: shopper.token })),
      404,
      "order-not-found",
    );
    const admin = await valueOf(
      postJson<Session>("/api/auth/login", {
        email: DEMO_ACCOUNTS.ADMIN_EMAIL,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect((await valueOf(getJson<Order>(seededPath, { sessionToken: admin.token }))).id).toBe(
      seeded.id,
    );

    // An order created with no session answers the key its submission carried, and nothing else: the
    // identifier on its own is refused, which is what its confirmation route presents the credential for.
    const key = "key-placement-credential";
    const created = await valueOf(
      postJson<Order>("/api/orders", await orderBody(key, DEMO_CARD_NUMBERS.APPROVED)),
    );
    expect(created.customerId).toBeNull();
    const createdPath = `/api/orders/${created.id}`;
    expectRefusal(await refusalOf(getJson(createdPath)), 401, "unauthenticated");
    expect((await valueOf(getJson<Order>(createdPath, { orderToken: key }))).id).toBe(created.id);
    // The credential is held against the order it placed, not as a key to every account-less order.
    expectRefusal(
      await refusalOf(getJson(seededPath, { orderToken: key })),
      401,
      "unauthenticated",
    );
  });
});
