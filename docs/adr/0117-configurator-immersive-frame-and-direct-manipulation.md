# ADR 0117 — The immersive configurator frame and the §7.6 direct-manipulation loop

**Status:** Accepted (2026-07-20 — decided by Martin during the ADR 0114 Phase 1b
configurator wave; scope of the tool dock confirmed by Martin this session).
Delivers the `v2-IMM` frame and the CORE_SPEC §7.6 direct-manipulation contract
that [ADR 0116](0116-configurator-commercial-plumbing-and-surface.md) explicitly
deferred "as their own commit". Builds on ADR 0116 (the surface + the worker
transport), [ADR 0115](0115-release-authored-wizard-steps.md) (the step model)
and [ADR 0114](0114-design-canvas-adoption.md) (the design authority). Supersedes
neither.

## Context

`design/configurator/frames-v2.jsx` draws the configurator at five frames. ADR
0116 shipped four of them (the banded desktop / tablet / mobile layouts). The
fifth — `FrameImmersive` (`v2-IMM`) — is an edge-to-edge scene editor with corner
resize handles, editable dimension pills, a part-selection affordance and a
six-tool dock. It is not a layout variant; it is the home of the §7.6
direct-manipulation interaction contract ("the hardest part of phase 1"), which
`scene-canvas.tsx` had no picking, no handles and no drag loop for. This ADR
records how that loop is built and the choices the release data forced open.

## Decision

### 1. Immersive is a layout MODE, and the WebGL canvas never remounts on toggle

`immersive` is a slice of a new manipulation store (below), not `ConfiguratorInner`
React state, because both the app-land layout and the in-scene fullscreen toggle
must reach it. Entering immersive promotes the scene `<main>` to `fixed inset-0
z-50` and conditionally _unmounts_ the banded chrome (context bar, rail, form,
commerce bar) — but the `<main>` element itself is rendered in both branches, so
only its className changes. The scene subtree (`SceneColumn` → `SceneViewport` →
the `ssr:false` `SceneCanvas`) stays mounted across the toggle: no WebGL context
is recreated and no camera pose is lost. The banded chrome is cheap to
remount because the edited configuration lives in `input` on `ConfiguratorInner`,
above both layouts.

### 2. The §7.6 loop lives in a scene-layer store + an app-land bridge

The interaction rigs run inside the R3F `<Canvas>` (they need `useThree`/
`useFrame`), while the data and write paths they need (the parameter bindings,
the commit and preview callbacks) live in app-land. The two are joined the way
`useExplode`/`useSection` already join them: a **module-singleton zustand store**
(`scene/manipulation.ts`) that crosses the reconciler boundary without a context
bridge. `ConfiguratorInner` syncs an app-land **bridge** into that store each
render; the in-Canvas projector and the DOM handle/pill handlers read it.

The derive runs on the ADR 0116 engine worker. §7.6 mandates two cadences at two
edges: keystroke input debounces at 150 ms, a drag emits at most one derive per
animation frame. The keystroke path already existed; this slice adds
`requestImmediate` to `useConfiguratorDerive` — the internal, non-debounced
request — and the drag rAF-throttles calls to it. Last-write-wins by the existing
monotonic token makes an in-flight stale result safe to discard, so a
per-frame request rate is safe. Exactly one `commit` (an ordinary `setInput`)
fires on pointer-up, so the optimistic-lock version bumps once per gesture, and
the value round-trips through the same input state the form field writes — one
parameter, two editors (§7.6).

The drag clamps to the parameter's `range` domain (the outer rail); an in-domain
value that violates a constraint is a _valid_ drag target that surfaces its
defect live, which is why the clamp is the domain and not the constraint.

### 3. Dimension bindings are positional — a recorded heuristic

The pills and handles address a release parameter, but a release does not author
_which_ parameter is a spatial dimension. Decided: the first two visible
`range`-domain parameters, by declaration order, are the width and the height
(`opening_width_mm`, `clear_height_mm` on the shipped gate). This is a heuristic;
a parameter with no bounds cannot clamp a drag and is skipped, and a dimension
with no such parameter yields a null binding whose pill/handle is simply not
shown (§7.6: a pill that cannot address a form-exposed parameter is not shown).
The principled replacement is a schema `dimensionRole`, deferred behind its own
ADR alongside the ADR 0115 camera/view-role carry-over.

### 4. Výběr selects and identifies; it does NOT fabricate a parameter toolbar

The design frame draws a contextual part toolbar with a spacing stepper on the
selected part. The release authors **no binding from a rendered part to a
parameter** — the frame's spacing is a derived option-set attribute, not a user
parameter — so there is nothing for that stepper to address. §7.6's own rule
(a control that cannot address a form-exposed parameter is not shown) and the §5
scope fence forbid inventing the link. Decided: picking selects the part under
the cursor (a click distinguished from an orbit by a 5 px threshold), highlights
its pieces with a copper emissive glow, and names it in a fixed identity chip
with a clear action. The parameter editing that the frame's toolbar implies lives
where the data supports it — the corner handles and dimension pills. This is a
§11.2 recorded deviation from the drawn frame; a richer per-part toolbar needs
the same `dimensionRole`-class schema work as §3.

### 5. The tool dock — two modes, two delegations, two deferrals

`Výběr`/`Kóty` drive the manipulation store (`select` enables picking; `dim`
suppresses it so the pills/handles can be worked without selecting). `Řez`/
`Rozklad` delegate to the existing `useSection`/`useExplode` slices, so their
state stays single-sourced and the banded scrub sliders remain their home.
`Měřit`/`Otočit` are deferred (Martin's scope call this session) and render as
disabled affordances rather than being hidden, so the drawn tool set is legible
and the deferral is honest. `Otočit` in particular would reverse the deliberate
ADR 0077 named-pose decision (orbit is already available through the persistent
`CameraControls`, just not as an explicit dock mode).

### 6. Optimistic pre-derive geometry is deferred, with reason

§7.6 asks for optimistic geometry so the dragged shape updates ahead of the
derive. The naive implementation — scaling the scene group while the derive
catches up — **double-counts**, because the per-rAF worker derive already updates
the live scene during the drag; a scale layered on top would compound with it. A
correct optimistic layer needs a frozen drag-start snapshot reconciled on release,
which is a larger interaction-state coordination than this slice warrants. Chosen
instead: the handle and pill (DOM) track the pointer instantly, decoupled from
the derive, and the fast worker derive keeps the scene within a frame or two —
so the gesture never feels detached. Recorded as a deliberate deferral (§11.2).

## Consequences

- Any surface that mounts a hand-rolled control **inside** the `ssr:false`
  `SceneCanvas` is invisible to jsdom, so the standing gate and unit tests cannot
  see its keyboard/focus behaviour. Such controls must be covered by
  isolated-render tests. The adversarial review pass caught **five** such defects
  in gate-green work — two of them the exact focus-to-`<body>` regression the
  banded Back/Next were already rewritten to avoid (a native `disabled` attribute
  on a focused control at a flow boundary; an editor that opened focus but never
  restored it on close). All five are fixed and now carry isolated-render tests.
  → vault finding _Controls inside an `ssr:false` WebGL subtree are jsdom-invisible_.

- The manipulation store is a module singleton, so `ConfiguratorInner` resets it
  on both mount and unmount, and leaving immersive clears the selection and any
  live drag at the store setter (the banded 3D view has no affordance to dismiss
  a stale selection glow).

- The keyboard nudge on a handle is its own micro-drag: OS key-repeat accumulates
  in a local ref and previews live, committing once on key-up — it must not read
  the committed `binding.value` per repeat, which lags the debounced derive and
  would stall the scene until key release.

- **Eyes-on (§12.1 item 6) is PENDING.** The authenticated integrated capture —
  the immersive frame rendered with the real scene at the ship-bar widths in both
  themes — requires credentials this autonomous session did not have and must not
  guess or reset. The harness is ready: `apps/web/scripts/verify/capture-configurator.mjs`
  now enters immersive at every width ≥ 1194 and screenshots it in both themes.
  Running it (one command with a configured tenant's credentials) is the
  remaining bar before this surface is formally done.

- Not built here and unchanged from ADR 0116's fences: the deviation-ledger
  _Povolit odchylku_ action, the commercial CTAs, project binding. The immersive
  commercial chip carries no CTA and is absent (not masked) when price-blind.
