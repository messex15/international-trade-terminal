// Customer lists: one per workspace (see workspaceOf in http.mjs). Shared by
// the customers function and by saving a quote, which adds a new customer.
import { cleanText, customerStore, HttpError, newId, normName, updateJsonDoc } from "./http.mjs";

export const EMPTY_CUSTOMERS = { version: 1, customers: [] };
export const MAX_CUSTOMERS = 2000;

/** Staff: customers.json. Client workspaces: company/<id>.json or link/<id>.json. */
export const customerListKey = (ws) => (ws.prefix ? `${ws.prefix.slice(0, -1)}.json` : "customers.json");

export const hasCustomer = (customers, name, exceptId = null) =>
  customers.some((c) => c.id !== exceptId && normName(c.name) === normName(name));

export function assertUniqueName(customers, name, exceptId = null) {
  if (hasCustomer(customers, name, exceptId)) throw new HttpError(409, `${name} is already on the customer list.`);
}

/**
 * Adds a customer by name, with the delivery terms of the quote it came from,
 * unless the list already has one by that name (ignoring case and spacing) or
 * is full. Returns the customer added, or null.
 */
export async function addCustomerIfNew(ws, { name, deliveryTerms }, session) {
  const clean = cleanText(name, 100);
  if (!clean) return null;
  const store = customerStore();
  const key = customerListKey(ws);
  const doc = (await store.get(key, { type: "json" })) || EMPTY_CUSTOMERS;
  if (hasCustomer(doc.customers, clean) || doc.customers.length >= MAX_CUSTOMERS) return null;
  const now = new Date().toISOString();
  return updateJsonDoc(store, key, EMPTY_CUSTOMERS, (current) => {
    if (hasCustomer(current.customers, clean) || current.customers.length >= MAX_CUSTOMERS) return { doc: current, value: null };
    const added = {
      id: newId(), name: clean, contact: "", email: "", phone: "", country: "", deliveryTerms: cleanText(deliveryTerms, 80), notes: "",
      createdAt: now, createdBy: session.label, updatedAt: now, updatedBy: session.label,
    };
    return { doc: { ...current, customers: [...current.customers, added] }, value: added };
  });
}
