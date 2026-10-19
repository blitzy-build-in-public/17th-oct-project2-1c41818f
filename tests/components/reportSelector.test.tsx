/**
 * Path: tests/components/reportSelector.test.tsx
 * Purpose: The reports route's cut control: the value it reports, whether one of its own choices carried it or not, and the cut and report the page holds either way
 * Lines: 150
 */

import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { ACCOUNT_COPY } from "@/constants/content";
import { REPORTS_COPY } from "@/constants/content-reports";
import { ROUTES } from "@/constants/routes";
import { GRANULARITY_OPTIONS, REPORT_DEFINITIONS } from "@/constants/taxonomy";

import { renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { RenderHarness, UserEvent } from "../testUtils";

/*
 * The cut control's guard, reached through the control the page renders.
 *
 * `ReportsPage.tsx` resolves the value a `<select>` reported through `toBucketGranularity`, which answers the
 * cut only for a value one of `GRANULARITY_OPTIONS` carries, and it moves its state only for an answer it
 * found (`next !== null`). Both of those arms are the two the rest of the suite cannot reach: the other report
 * cases always pick a genuine choice, and the driver refuses anything else. A native `<select>` left with no
 * matching option is where the guard applies, and the page is reached here the way the administrator flow
 * reaches it — the real application, its real providers, the seeded administrator credential and the route's
 * own redirect to sign-in.
 *
 * The page's remaining lookups cannot miss through any input the product can be given, which is why no case
 * here tries to: the selector reports the id of a tab the page itself built from the catalogue in hand, so
 * `toReportKind` always finds it; the cut state's own fallback needs the opening definition to declare no
 * cut, which the taxonomy constant always declares; and the empty-catalogue state needs the seam to answer
 * with no definitions, which its repository never does — it serves `REPORT_DEFINITIONS` itself.
 */

// The route, the report it opens on and the control under test ------------------------------------

/** The sign-in form's controls; a required field's label also carries the hidden requirement text. */
const EMAIL_FIELD = new RegExp(`^${ACCOUNT_COPY.EMAIL_LABEL}`);
const PASSWORD_FIELD = new RegExp(`^${ACCOUNT_COPY.PASSWORD_LABEL}`);

/** The cut control's accessible name — its choices' own words, joined — for reading it off the page. */
const CUT_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");

/** The cut the route opens on: the opening definition's own, which the cut control starts holding. */
const OPENING_CUT = REPORT_DEFINITIONS[0].granularity;

/** A cut one of the control's choices genuinely carries, so a real choice is one the control offers. */
const CHOSEN_CUT = GRANULARITY_OPTIONS[2].value;

/** The report the route opens on, which is the report a reader who changes only the cut is reading. */
const OPENING_REPORT = REPORT_DEFINITIONS[0];

/**
 * The values a `<select>` can report that its own choices do not carry.
 *
 * The platform clears the selectedness of every option when the value a control is given matches none of
 * them, and the control then reports the empty string — so an empty value, a value no choice declares at all
 * and one that differs from a choice only in case are one input, and are one case below rather than three.
 */
const UNCARRIED_CUTS = ["", "quarterly", "Day"] as const;

/** The caption the opening report's own table carries, which is what its rows are read through. */
const REPORT_TABLE_NAME = new RegExp(`^${OPENING_REPORT.name}\\.`);

/** The rows the selected report's own table paints, found by the caption the table carries. */
function reportRows(): readonly HTMLElement[] {
  return within(screen.getByRole("table", { name: REPORT_TABLE_NAME })).getAllByRole("row");
}

/** The rows of the report the route opens on, once the run that fills its table has landed: the cut control
 *  is painted by the shell that precedes the catalogue too, so the table is what says the page is settled. */
async function settleOpenedReport(): Promise<number> {
  await screen.findByRole("table", { name: REPORT_TABLE_NAME });
  return reportRows().length;
}

/** Fills the sign-in screen the guard sent the visitor to and submits it. */
async function submitSignIn(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(EMAIL_FIELD), email);
  await user.type(screen.getByLabelText(PASSWORD_FIELD), DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() => expect(screen.queryByLabelText(EMAIL_FIELD)).toBeNull());
}

/** The administrator's view of the reports route, reached through the guard's own sign-in redirect. */
async function openReports(): Promise<RenderHarness> {
  const app = renderApp({ route: ROUTES.ADMIN_REPORTS });
  await submitSignIn(app.user, DEMO_ACCOUNTS.ADMIN_EMAIL);
  return app;
}

beforeEach(() => {
  resetApiState();
});

describe("the cut control of the reports route", () => {
  it.each(UNCARRIED_CUTS)(
    "ignores the value %j, which no choice carries, and keeps the cut and the report in force",
    async (value) => {
      await openReports();

      // The page's own cut in force, and the report the reader is reading: the table the sales report
      // paints for the period it was handed.
      const rowsBefore = await settleOpenedReport();
      const cut = screen.getByLabelText(CUT_CONTROL_LABEL);
      expect(cut).toHaveValue(OPENING_CUT);
      expect(screen.getByRole("tab", { name: OPENING_REPORT.name })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      // The driver cannot express this input: `user-event`'s `selectOptions` refuses any value its own option
      // list does not hold — it throws `Value "…" not found in options` — while the platform allows it, since
      // a `<select>`'s value setter clears the selectedness of every option when none carries the value and
      // the control then reports the empty string. That is the state the handler's guard is written for.
      fireEvent.change(cut, { target: { value } });

      // Nothing the reader set moved: the control still reports the cut in force, the report the reader was
      // reading still holds the region, and no run was refused or re-bucketed.
      await waitFor(() => expect(cut).toHaveValue(OPENING_CUT));
      expect(screen.getByRole("tabpanel", { name: OPENING_REPORT.name })).toBeInTheDocument();
      expect(reportRows()).toHaveLength(rowsBefore);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("moves the cut to the choice it reports, leaving the report the reader had selected", async () => {
    const { user } = await openReports();

    const rowsBefore = await settleOpenedReport();
    const cut = screen.getByLabelText(CUT_CONTROL_LABEL);

    await user.selectOptions(cut, CHOSEN_CUT);

    // The same handler the ignored value went through moves the cut for a choice the control offers, which
    // is what makes the ignored value's outcome above the guard's work rather than the event's absence.
    await waitFor(() => expect(cut).toHaveValue(CHOSEN_CUT));
    expect(screen.getByRole("tab", { name: OPENING_REPORT.name })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tablist", { name: REPORTS_COPY.SELECTOR_LABEL })).toBeInTheDocument();

    // The wider cut buckets the same period into fewer rows, so the run that replaced the table is the run
    // the period and the new cut resolve to.
    await waitFor(() => expect(reportRows().length).toBeLessThan(rowsBefore));
  });
});
