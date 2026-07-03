import { type Customer } from "@repo/validators";

/**
 * In-memory customer store for the mock tier (ADR 0082). Seeds a couple of
 * odběratelé so the issue-flow customer picker renders; create appends.
 */
function seedCustomer(index: number, over: Partial<Customer>): Customer {
  const seq = String(index).padStart(12, "0");
  const now = `2026-06-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`;
  return {
    id: `00000000-0000-7000-9000-${seq}`,
    name: `Customer ${index}`,
    ico: null,
    dic: null,
    vatPayer: false,
    email: null,
    phone: null,
    addressLine: null,
    city: null,
    postalCode: null,
    country: "CZ",
    note: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

let customers: Customer[] = [];
let createSeq = 0;

function seed(): Customer[] {
  return [
    seedCustomer(1, {
      name: "Bartek Vrata s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
    }),
    seedCustomer(2, { name: "Jan Novák", city: "Brno" }),
  ];
}
customers = seed();

export function listCustomerFixtures(): Customer[] {
  return [...customers];
}

export function insertCustomerFixture(input: {
  name: string;
  ico?: string | null;
  dic?: string | null;
  vatPayer?: boolean;
}): Customer {
  createSeq += 1;
  const customer = seedCustomer(100 + createSeq, {
    name: input.name,
    ico: input.ico ?? null,
    dic: input.dic ?? null,
    vatPayer: input.vatPayer ?? false,
  });
  customers.push(customer);
  return customer;
}

/** Find a customer by id — the mock parity for `GET /v1/customers/:id`. */
export function findCustomerFixture(id: string): Customer | undefined {
  return customers.find((c) => c.id === id);
}

/** Apply a partial patch — the mock parity for `PATCH /v1/customers/:id`
 *  (covers both field edits and the archive/restore status-only PATCH). */
export function updateCustomerFixture(id: string, patch: Partial<Customer>): Customer | undefined {
  const index = customers.findIndex((c) => c.id === id);
  if (index === -1) return undefined;
  const updated = { ...customers[index]!, ...patch, updatedAt: new Date().toISOString() };
  customers[index] = updated;
  return updated;
}

export function resetCustomers(): void {
  customers = seed();
  createSeq = 0;
}
