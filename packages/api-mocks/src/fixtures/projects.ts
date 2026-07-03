import { type Project } from "@repo/validators";

/**
 * In-memory project store for the mock tier (ADR 0018). Seeded with a
 * deterministic set whose ids are uuidv7-SHAPED and strictly increasing with
 * creation order — the contract the keyset cursor relies on (uuidv7 IS
 * creation order). Creates/archives/deletes mutate the store so the mock
 * behaves like a persistence-backed resource within one process lifetime.
 */

const SEED_COUNT = 25;

function seedProject(index: number): Project {
  const seq = String(index).padStart(12, "0");
  return {
    // Version nibble 7 keeps z.uuid() happy and mirrors the real id scheme;
    // the trailing sequence makes lexicographic order == creation order.
    id: `00000000-0000-7000-8000-${seq}`,
    name: `Project ${index}`,
    description: index % 3 === 0 ? `Description for project ${index}` : null,
    status: index % 5 === 0 ? "archived" : "active",
    createdAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  };
}

let projects: Project[] = [];
/** Idempotency-Key -> created project (POST /v1/projects dedupe). */
let idempotencyStore = new Map<string, Project>();
let createSeq = SEED_COUNT;

/** A project's site document, mock-tier shape — mirrors `ProjectSite`
 *  (step 6.3c / ADR 0054): opaque `site` + roster + optimistic-lock version. */
export interface ProjectSiteFixture {
  site: unknown;
  instances: unknown[];
  version: number;
}

/** In-memory site-document store, keyed by project id. An absent key is a
 *  project with nothing designed yet — the real API's fresh-project default
 *  (`site: null, instances: [], version: 1`). */
let projectSites = new Map<string, ProjectSiteFixture>();

function seed(): Project[] {
  return Array.from({ length: SEED_COUNT }, (_, i) => seedProject(i + 1));
}
projects = seed();

/** All projects, newest-first by id (uuidv7 order == creation order). */
export function listProjectFixtures(): Project[] {
  return [...projects];
}

export function findProjectFixture(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export function insertProjectFixture(input: {
  name: string;
  description?: string | null;
}): Project {
  createSeq += 1;
  const seq = String(createSeq).padStart(12, "0");
  const now = new Date().toISOString();
  const project: Project = {
    id: `00000000-0000-7000-8000-${seq}`,
    name: input.name,
    description: input.description ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  projects.push(project);
  return project;
}

export function updateProjectFixture(
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "status">>,
): Project | undefined {
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  return project;
}

/** Soft delete — the mock simply drops the row from the visible set. */
export function deleteProjectFixture(id: string): boolean {
  const before = projects.length;
  projects = projects.filter((p) => p.id !== id);
  return projects.length < before;
}

export function rememberIdempotentCreate(key: string, project: Project): void {
  idempotencyStore.set(key, project);
}

export function recallIdempotentCreate(key: string): Project | undefined {
  return idempotencyStore.get(key);
}

/** GET /v1/projects/:id/site — the current doc, or the fresh-project default. */
export function getProjectSiteFixture(id: string): ProjectSiteFixture {
  return projectSites.get(id) ?? { site: null, instances: [], version: 1 };
}

/**
 * PUT /v1/projects/:id/site — full-document replace, guarded by the
 * optimistic-lock `expectedVersion` (ADR 0054): a mismatch against the CURRENT
 * version returns `"conflict"` (the caller 409s) instead of silently
 * overwriting a co-member's save.
 */
export function saveProjectSiteFixture(
  id: string,
  doc: { site: unknown; instances: unknown[] },
  expectedVersion: number,
): ProjectSiteFixture | "conflict" {
  const current = getProjectSiteFixture(id);
  if (current.version !== expectedVersion) return "conflict";
  const next: ProjectSiteFixture = {
    site: doc.site,
    instances: doc.instances,
    version: current.version + 1,
  };
  projectSites.set(id, next);
  return next;
}

/** Test helper — restore the seed set between cases. */
export function resetProjects(): void {
  projects = seed();
  idempotencyStore = new Map();
  createSeq = SEED_COUNT;
  projectSites = new Map();
}
