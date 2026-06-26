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

export function resetCustomers(): void {
  customers = seed();
  createSeq = 0;
}
