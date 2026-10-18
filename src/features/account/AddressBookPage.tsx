/**
 * Path: src/features/account/AddressBookPage.tsx
 * Purpose: Address cards with add, edit, remove and set-default actions, and a confirm dialog on removal
 * Lines: 563
 */

import { useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement, RefObject } from "react";

import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { Checkbox, Select } from "@/components/ui/Select";
import { editSectionLabel } from "@/constants/checkoutCopy";
import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  PAGE_TITLES,
  documentTitle,
  removeAddressLabel,
} from "@/constants/content";
import { ADDRESS_FIELDS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import {
  addAddress,
  addressLabel,
  buildAddressInput,
  defaultAddressFor,
  listAddresses,
  removeAddress,
  setDefaultAddress,
  toProfileFieldErrors,
  updateAddress,
} from "@/lib/customerService";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { handOffThen, useFocusHandoff } from "@/state/focusHandoff";
import { useRefusalFocus } from "@/state/focusHooks";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { Address, AddressInput, AddressKind } from "@/types/account";
import type { AddressId, FieldErrors, Result } from "@/types/common";
import { FORM_ERROR_KEY, hasErrors, validateAddress } from "@/utils/validation";

/*
 * Class contract. `src/styles/account.css` is the sole definition site of the address-book family and no
 * file under `src/features/**` imports a stylesheet, so every class here is consumed by name:
 * `sp-address-grid` for the card grid, which holds as many label-wide cards as its column fits, and
 * `sp-address-card` with its `__header`, `__label`, `__badges`, `__body`, `__defaults` and `__actions` parts on
 * the `sp-card` frame.
 * `sp-address-form` is the address field grid `src/styles/commerce.css` shares with the checkout's address
 * entry, `sp-stack` gives the section its rhythm, the set-default controls are `sp-choice` rows (the
 * touch-target floor `src/styles/controls.css` gives that family), and the removal confirmation is
 * `sp-confirm` from
 * `src/styles/data-display.css`, reached through `ConfirmDialog` and restated nowhere here.
 *
 * The address endpoints are scoped to the session's own customer and the seam refuses another account's path
 * with `403`, so this page reads the id and the token from the session `src/state/AuthContext.tsx` holds and
 * assembles neither.
 */

/** The values a new address starts from: every member of the body, because an update describes the whole
 * address, with the country opening on the first configured one. */
const BLANK_ADDRESS: AddressInput = {
  label: "",
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: SUPPORTED_COUNTRIES[0].code,
  phone: "",
};

/** The two placeholder cards the loading state renders in place of the grid the load will fill. */
const PLACEHOLDER_CARDS = ["first", "second"] as const;

/** The display name of a stored country code, falling back to the code for one the configured set dropped. */
function countryNameOf(code: string): string {
  return SUPPORTED_COUNTRIES.find((country) => country.code === code)?.label ?? code;
}

/** Whether a stored line carries something to show: neither absent nor blank. */
function isWritten(value: string): boolean {
  return value.trim().length > 0;
}

/** Everything {@link AddressForm} renders against. */
interface AddressFormProps {
  /** The address as the form holds it: the draft being added, or the projection of the one being edited. */
  readonly values: AddressInput;
  /** The errors to attach to their controls, keyed by `AddressInput`'s members, plus the form-wide key. */
  readonly errors: FieldErrors;
  /** Called with the whole address whenever a member changes; the form holds no state of its own. */
  readonly onChange: (values: AddressInput) => void;
  /** Called on submit — from the form's own event, so Enter in a field places it too. */
  readonly onSubmit: () => void;
  /** The dialog's opening focus, which starts on the first field rather than on the close control. */
  readonly firstFieldRef: RefObject<HTMLInputElement | null>;
}

/**
 * The address form, used for both adding and editing: one implementation, because two forms would drift on
 * their field set, their validation and their default-flag handling, and because this is the same address rule
 * the checkout's shipping step runs. Errors reach each control through the shared map the field reads by its
 * `name`, and `noValidate` leaves the judging to `src/utils/validation.ts` rather than to the browser.
 *
 * The address's own label is deliberately not a field: `src/constants/content.ts` holds no sentence for one,
 * so an edited address keeps the label it carries and a new one takes `addressLabel`'s fallback.
 *
 * @param props - The draft, the errors, the change and submit sinks and the opening-focus ref.
 * @returns The form, with every field of the address body inside it.
 */
function AddressForm({
  values,
  errors,
  onChange,
  onSubmit,
  firstFieldRef,
}: AddressFormProps): ReactElement {
  // One factory for every control, the select included: a member is always written from a string.
  const changeMember =
    (member: keyof AddressInput) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      onChange({ ...values, [member]: event.target.value });
    };

  return (
    <form
      className="sp-address-form"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {ADDRESS_FIELDS.map((field, index) =>
        field.options === undefined ? (
          <Input
            key={field.member}
            ref={index === 0 ? firstFieldRef : undefined}
            autoComplete={field.autoComplete}
            errors={errors}
            hint={field.hint}
            label={field.label}
            name={field.member}
            onChange={changeMember(field.member)}
            required={field.required}
            type={field.type ?? "text"}
            value={values[field.member]}
          />
        ) : (
          <Select
            key={field.member}
            autoComplete={field.autoComplete}
            errors={errors}
            label={field.label}
            name={field.member}
            onChange={changeMember(field.member)}
            options={field.options}
            required={field.required}
            value={values[field.member]}
          />
        ),
      )}
    </form>
  );
}

/** Everything {@link AddressCard} renders against. */
interface AddressCardProps {
  /** The address to render, with the two default flags the seam last served. */
  readonly address: Address;
  readonly isDefaultShipping: boolean;
  readonly isDefaultBilling: boolean;
  /** Whether a set-default request this card started is in flight. */
  readonly isNaming: boolean;
  readonly onEdit: (address: Address) => void;
  readonly onRemove: (address: Address) => void;
  readonly onSetDefault: (address: Address, kind: AddressKind) => void;
}

/**
 * One address: the name it is shown under with its default badges, the address itself, the two set-default
 * controls and the actions. Everything shown is read from the stored address and the configured country list;
 * the defaults are stated in words by their badges and carried by their controls' checked state, never by
 * colour alone; and each action's accessible name names the address it acts on.
 *
 * The set-default control sets and never clears, because the endpoint nominates an address for one kind and
 * the seam owns what that does to the other flag.
 *
 * @param props - The address, its two default states, the in-flight flag and the three actions.
 * @returns The address card.
 */
function AddressCard({
  address,
  isDefaultBilling,
  isDefaultShipping,
  isNaming,
  onEdit,
  onRemove,
  onSetDefault,
}: AddressCardProps): ReactElement {
  const name = addressLabel(address);
  // The locality reads as "Portland, OR 97205" rather than as three comma-separated parts.
  const cityLine = [[address.city, address.region].filter(isWritten).join(", "), address.postalCode]
    .filter(isWritten)
    .join(" ");

  return (
    <Card as="li" className="sp-address-card">
      <div className="sp-address-card__header">
        <h3 className="sp-address-card__label">{name}</h3>
        {isDefaultShipping || isDefaultBilling ? (
          <div className="sp-address-card__badges">
            {isDefaultShipping ? (
              <Badge variant="info">{ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE}</Badge>
            ) : null}
            {isDefaultBilling ? (
              <Badge variant="info">{ACCOUNT_COPY.DEFAULT_BILLING_BADGE}</Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="sp-address-card__body">
        <p>{address.fullName}</p>
        <p>{address.line1}</p>
        {isWritten(address.line2) ? <p>{address.line2}</p> : null}
        {isWritten(cityLine) ? <p>{cityLine}</p> : null}
        <p>{countryNameOf(address.country)}</p>
        {isWritten(address.phone) ? <p>{address.phone}</p> : null}
      </div>
      <div className="sp-address-card__defaults">
        <Checkbox
          checked={isDefaultShipping}
          isDisabled={isNaming}
          label={ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL}
          onChange={(event): void => {
            if (event.target.checked) onSetDefault(address, "shipping");
          }}
        />
        <Checkbox
          checked={isDefaultBilling}
          isDisabled={isNaming}
          label={ACCOUNT_COPY.SET_DEFAULT_BILLING_LABEL}
          onChange={(event): void => {
            if (event.target.checked) onSetDefault(address, "billing");
          }}
        />
      </div>
      <div className="sp-address-card__actions">
        <Button
          aria-label={editSectionLabel(name)}
          onClick={(): void => onEdit(address)}
          size="sm"
          variant="secondary"
        >
          {COMMON_ACTIONS.EDIT}
        </Button>
        <Button
          aria-label={removeAddressLabel(name)}
          onClick={(): void => onRemove(address)}
          size="sm"
          variant="danger"
        >
          {COMMON_ACTIONS.REMOVE}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The customer's address book: every saved address as a card, with the actions that change it. The page owns
 * no address rule of its own — `src/lib/customerService.ts` decides what a valid address is, which address
 * holds which default and which one inherits a default that was removed — so it renders what a read returns,
 * asks for one change at a time and re-reads the book afterwards rather than patching a local copy, which is
 * what keeps the default flags from being computed in two places. Failures are values rather than exceptions,
 * so nothing here catches: a failed read renders the shared error state with a retry, and a failed change is
 * reported where the customer is looking.
 *
 * @returns The address book section, with its dialog and its confirmation.
 */
export function AddressBookPage(): ReactElement {
  useDocumentTitle(documentTitle(PAGE_TITLES.ADDRESSES));

  // The session is the only source of the id the address endpoints are scoped by, and of the token that
  // carries it: the seam refuses a path naming an account the session does not own, so this page assembles
  // neither and invents nothing. With no session the read is suppressed and the page says why.
  const { session } = useAuth();
  const customerId = session?.customerId ?? null;
  const sessionToken = session?.token;
  const toasts = useToast();

  const headingId = useId();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  /**
   * The region this page hands the focus off to, and the arming call each changing action makes.
   *
   * Every action that changes the book takes the control that raised it away — a removal unmounts the card, a
   * save unmounts the dialog and, with the re-read after it, the card an edited control belonged to, and a
   * nomination disables the toggle in hand — so none of them can hand the focus back to the control that raised
   * it. The section's own heading takes it instead, which keeps a keyboard user inside the region they were
   * working in rather than at the top of the document.
   */
  const { regionRef, handOffFocus } = useFocusHandoff<HTMLHeadingElement>();

  const [draft, setDraft] = useState<AddressInput | null>(null);
  const [editing, setEditing] = useState<Address | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<Address | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [namingId, setNamingId] = useState<AddressId | null>(null);

  const loadAddresses = (signal: AbortSignal): Promise<Result<Address[]>> =>
    customerId === null
      ? Promise.resolve<Result<Address[]>>({ ok: true, value: [] })
      : listAddresses(customerId, { sessionToken, signal });
  const {
    data,
    error,
    reload: reloadAddresses,
    status,
  } = useAsync<Address[]>(loadAddresses, [customerId, sessionToken], {
    enabled: customerId !== null,
  });

  const addresses = data ?? [];
  const shippingDefaultId = defaultAddressFor(addresses, "shipping")?.id;
  const billingDefaultId = defaultAddressFor(addresses, "billing")?.id;
  const formHeading =
    editing === null ? ACCOUNT_COPY.ADD_ADDRESS_LABEL : editSectionLabel(addressLabel(editing));

  // A refused save lands the keyboard on the dialog's own alert, or on the first control the failure named.
  useRefusalFocus(hasErrors(fieldErrors), alertRef, formRef);
  // Once the book is known to be empty the empty state is the one control that offers the add action, so the
  // section offers it only while the book is loading, failed or holding addresses.
  const offersAddAction = status !== "success" || addresses.length > 0;

  const openAdd = (): void => {
    setEditing(null);
    setDraft(BLANK_ADDRESS);
    setFieldErrors({});
  };

  const openEdit = (address: Address): void => {
    setEditing(address);
    setDraft(buildAddressInput(address));
    setFieldErrors({});
  };

  const closeForm = (): void => {
    setEditing(null);
    setDraft(null);
    setFieldErrors({});
  };

  const changeDraft = (values: AddressInput): void => {
    setDraft(values);
  };

  const requestRemoval = (address: Address): void => {
    setPendingRemoval(address);
  };

  const cancelRemoval = (): void => {
    setPendingRemoval(null);
  };

  const saveAddress = async (): Promise<void> => {
    if (customerId === null || draft === null) return;
    const errors = validateAddress(draft);
    if (hasErrors(errors)) {
      setFieldErrors(errors);
      return;
    }
    setIsSaving(true);
    const result =
      editing === null
        ? await addAddress(customerId, draft, { sessionToken })
        : await updateAddress(customerId, editing.id, draft, { sessionToken });
    setIsSaving(false);
    if (!result.ok) {
      const mapped = toProfileFieldErrors(result.error);
      setFieldErrors(mapped);
      // A failure naming no control has nowhere to sit in the form, so it is reported where the customer is
      // looking: the alert inside the dialog, and the toast beside it.
      if (FORM_ERROR_KEY in mapped) toasts.error(result.error.message);
      return;
    }
    // Armed before the dialog closes: the re-read below stands skeletons where the cards were, so neither the
    // control that opened the dialog nor the one that saved survives to hold the focus — the heading does.
    handOffFocus();
    closeForm();
    toasts.success(FEEDBACK_COPY.TOAST_ADDRESS_SAVED);
    reloadAddresses();
  };

  const nominateDefault = async (address: Address, kind: AddressKind): Promise<void> => {
    if (customerId === null) return;
    // Armed before the toggle is disabled: a control the browser disables gives the focus up, so the heading
    // has to claim it on the very commit that disables the one the customer just activated.
    handOffFocus();
    setNamingId(address.id);
    const result = await setDefaultAddress(customerId, address.id, kind, { sessionToken });
    setNamingId(null);
    if (!result.ok) {
      toasts.error(result.error.message);
      return;
    }
    toasts.success(FEEDBACK_COPY.TOAST_ADDRESS_SAVED);
    reloadAddresses();
  };

  const confirmRemoval = async (): Promise<void> => {
    if (customerId === null || pendingRemoval === null) return;
    setIsRemoving(true);
    const result = await removeAddress(customerId, pendingRemoval.id, { sessionToken });
    setIsRemoving(false);
    if (!result.ok) {
      toasts.error(result.error.message);
      return;
    }
    // Armed before the dialog closes: the removal unmounts the control that confirmed it and, with the re-read
    // below, the card it belonged to, so the heading the handoff names takes the focus the browser would
    // otherwise drop onto the document body.
    handOffFocus();
    setPendingRemoval(null);
    toasts.success(FEEDBACK_COPY.TOAST_ADDRESS_REMOVED);
    // The default a removed address held falls to the most recently added address that remains — the
    // service's rule, applied over the stored book — so the successor arrives with the re-read below.
    reloadAddresses();
  };

  const setAddressDefault = (address: Address, kind: AddressKind): void => {
    void nominateDefault(address, kind);
  };

  const renderBook = (): ReactElement => {
    if (status === "error" && error !== null) {
      return (
        <Alert
          actionLabel={COMMON_ACTIONS.RETRY}
          error={error}
          onAction={handOffThen(handOffFocus, reloadAddresses)}
          tone="danger"
        />
      );
    }
    if (status !== "success") {
      return (
        <div aria-busy="true" className="sp-address-grid">
          {PLACEHOLDER_CARDS.map((placeholder) => (
            <Skeleton key={placeholder} variant="card" />
          ))}
        </div>
      );
    }
    if (addresses.length === 0) {
      return <EmptyState headingLevel={2} onAction={openAdd} surface="addresses" />;
    }
    return (
      <ul className="sp-address-grid" role="list">
        {addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            isDefaultBilling={billingDefaultId === address.id}
            isDefaultShipping={shippingDefaultId === address.id}
            isNaming={namingId === address.id}
            onEdit={openEdit}
            onRemove={requestRemoval}
            onSetDefault={setAddressDefault}
          />
        ))}
      </ul>
    );
  };

  return (
    <section aria-labelledby={headingId} className="sp-stack">
      <h2 id={headingId} ref={regionRef} tabIndex={-1}>
        {ACCOUNT_COPY.ADDRESS_BOOK_HEADING}
      </h2>
      {customerId === null ? (
        <Alert tone="warning">{FEEDBACK_COPY.SIGN_IN_REQUIRED}</Alert>
      ) : (
        <>
          {offersAddAction ? (
            // The wrapper is what keeps the action at its own width: a lone grid child of the section is
            // stretched across the column, and the button shrink-wraps inside a block box.
            <div>
              <Button onClick={openAdd} variant="primary">
                {ACCOUNT_COPY.ADD_ADDRESS_LABEL}
              </Button>
            </div>
          ) : null}
          {renderBook()}
        </>
      )}
      {draft === null ? null : (
        <Modal
          footer={
            <>
              <Button onClick={closeForm} variant="secondary">
                {COMMON_ACTIONS.CANCEL}
              </Button>
              <Button
                isLoading={isSaving}
                onClick={(): void => {
                  void saveAddress();
                }}
                variant="primary"
              >
                {COMMON_ACTIONS.SAVE}
              </Button>
            </>
          }
          initialFocusRef={firstFieldRef}
          isOpen
          onClose={closeForm}
          title={formHeading}
        >
          {fieldErrors[FORM_ERROR_KEY] === undefined ? null : (
            <div ref={alertRef} tabIndex={-1}>
              <Alert tone="danger">{fieldErrors[FORM_ERROR_KEY]}</Alert>
            </div>
          )}
          <div ref={formRef}>
            <AddressForm
              errors={fieldErrors}
              firstFieldRef={firstFieldRef}
              onChange={changeDraft}
              onSubmit={(): void => {
                void saveAddress();
              }}
              values={draft}
            />
          </div>
        </Modal>
      )}
      <ConfirmDialog
        confirmLabel={ACCOUNT_COPY.CONFIRM_REMOVE_ADDRESS_LABEL}
        initialFocus="cancel"
        isBusy={isRemoving}
        isDestructive
        isOpen={pendingRemoval !== null}
        message={ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_BODY}
        onCancel={cancelRemoval}
        onConfirm={(): void => {
          void confirmRemoval();
        }}
        title={ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE}
      />
    </section>
  );
}
