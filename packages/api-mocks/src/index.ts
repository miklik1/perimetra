// Core barrel — framework-agnostic mock infrastructure. Intentionally free of
// any `msw` import so the Next BFF (which uses only the dispatcher) never pulls
// MSW into a server bundle; the MSW adapter lives behind `@repo/api-mocks/msw`.

export { matchPattern, findRoute } from "./core/router";
export {
  executeRoute,
  runMock,
  resolveMock,
  stripApiPrefix,
  type MockDispatchConfig,
} from "./core/dispatch";
export { errorEnvelope, dispatchMockError } from "./core/response-envelope";
export {
  MockHttpError,
  type MockRoute,
  type MockMethod,
  type MockHandler,
  type MockRequestContext,
  type MockRouteResult,
  type MockResponse,
} from "./core/types";

export { authRoutes } from "./handlers/auth";
export { projectRoutes } from "./handlers/projects";
export { routeGroups, selectRoutes, allRoutes, createMockConfig } from "./config";
export { listMockUsers } from "./fixtures/users";
export { listProjectFixtures, resetProjects } from "./fixtures/projects";
export { resetSessions } from "./fixtures/session";
// @gen:exports — `pnpm gen api-resource` adds the resource mock route export here.
