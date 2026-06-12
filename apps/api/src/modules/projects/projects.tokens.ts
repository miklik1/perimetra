/**
 * Event-type names (own file — same cycle-avoidance rule as
 * `auth.tokens.ts`): the api-side service emits them, the worker-side
 * handler consumes them, neither imports the other.
 */
export const PROJECT_CREATED = "project.created";
export const PROJECT_ARCHIVED = "project.archived";
