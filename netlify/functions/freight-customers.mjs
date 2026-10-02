// Customer list, shared by everyone who uses the Freight Desk, so a quote can
// pick its customer (and their usual delivery terms) instead of retyping them.
// GET    /api/freight/customers        the list, A to Z
// POST   /api/freight/customers        add { name, contact, email, phone, country, deliveryTerms, notes }
// PUT    /api/freight/customers/:id    update
// DELETE /api/freight/customers/:id    remove (saved quotes keep the name they were saved with)
import {
  assertSameOrigin,
  cleanText,
  customerStore,
  HttpError,
  json,
  newId,
  readJson,
  requireSession,
  route,
  updateJsonDoc,
} from "../lib/http.mjs";

const KEY = "customers.json";
const EMPTY = { version: 1, customers: [] };
const MAX_CUSTOMERS = 2000;

const normName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
const byName = (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

function cleanCustomer(body) {
  const name = cleanText(body.name, 100);
  if (!name) throw new HttpError(400, "Enter the customer's name.");
  const email = cleanText(body.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address does not look right.");
  return {
    name,
    contact: cleanText(body.contact, 100),
    email,
    phone: cleanText(body.phone, 40),
    country: cleanText(body.country, 60),
    deliveryTerms: cleanText(body.deliveryTerms, 80),
    notes: cleanText(body.notes, 1000),
  };
}

function assertUniqueName(customers, name, exceptId = null) {
  if (customers.some((c) => c.id !== exceptId && normName(c.name) === normName(name))) {
    throw new HttpError(409, `${name} is already on the customer list.`);
  }
}

export default route(async (req, context) => {
  const session = await requireSession(req);
  const store = customerStore();
  const id = context.params?.id;
  if (id && !/^[a-z0-9]{9}-[a-z0-9]{6}$/.test(id)) throw new HttpError(404, "No customer with that id.");

  if (req.method === "GET" && !id) {
    const doc = (await store.get(KEY, { type: "json" })) || EMPTY;
    return json({ customers: [...doc.customers].sort(byName) });
  }

  assertSameOrigin(req);
  const now = new Date().toISOString();

  if (req.method === "POST" && !id) {
    const fields = cleanCustomer(await readJson(req, 10_000));
    const customer = await updateJsonDoc(store, KEY, EMPTY, (doc) => {
      if (doc.customers.length >= MAX_CUSTOMERS) throw new HttpError(400, `The customer list is full (${MAX_CUSTOMERS} customers).`);
      assertUniqueName(doc.customers, fields.name);
      const added = { id: newId(), ...fields, createdAt: now, createdBy: session.label, updatedAt: now, updatedBy: session.label };
      return { doc: { ...doc, customers: [...doc.customers, added] }, value: added };
    });
    return json({ customer }, 201);
  }

  if (req.method === "PUT" && id) {
    const fields = cleanCustomer(await readJson(req, 10_000));
    const customer = await updateJsonDoc(store, KEY, EMPTY, (doc) => {
      const current = doc.customers.find((c) => c.id === id);
      if (!current) throw new HttpError(404, "No customer with that id. It may have been removed.");
      assertUniqueName(doc.customers, fields.name, id);
      const updated = { ...current, ...fields, updatedAt: now, updatedBy: session.label };
      return { doc: { ...doc, customers: doc.customers.map((c) => (c.id === id ? updated : c)) }, value: updated };
    });
    return json({ customer });
  }

  if (req.method === "DELETE" && id) {
    await updateJsonDoc(store, KEY, EMPTY, (doc) => {
      if (!doc.customers.some((c) => c.id === id)) throw new HttpError(404, "No customer with that id. It may have been removed.");
      return { doc: { ...doc, customers: doc.customers.filter((c) => c.id !== id) }, value: null };
    });
    return json({ ok: true });
  }

  throw new HttpError(405, "Method not allowed.");
});

export const config = {
  path: ["/api/freight/customers", "/api/freight/customers/:id"],
  method: ["GET", "POST", "PUT", "DELETE"],
};
