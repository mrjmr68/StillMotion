# Why browserslist is pinned low

Next 16's compile target is `package.json` browserslist, and it is **global** —
there is no per-route target. Spec §3 asks `/stage` for ES2015 output; the
console has no such constraint and runs on a current phone.

With no browserslist, Next's default floor is around **Chrome 109**, and the
emitted stage bundle contained 38 optional chainings, 60 nullish coalescings and
a logical assignment. A television browser below Chrome 80 cannot *parse* that
file, so it throws a `SyntaxError`, no client code runs at all, and the screen
shows the server-rendered shell frozen forever. That is what happened: a pairing
screen stuck on `····` with zero `/api/stage/*` requests in the server log.

So the target is pinned to the widest thing still worth supporting. The cost
falls entirely on the console — a slightly larger bundle on a phone that does not
care. The benefit is the one screen that cannot be debugged gets a file its
engine can read.

**Floors, and why each one:**

| entry | reason |
| --- | --- |
| `chrome >= 64` | below optional chaining (80) and logical assignment (85); covers Tizen and webOS sets built on Chromium 6x |
| `edge >= 79` | first Chromium Edge; legacy EdgeHTML is not a television |
| `firefox >= 68` | the ESR that matches that era |
| `safari >= 12` | tvOS/AirPlay-adjacent WebKit |
| `samsung >= 9` | Samsung Internet is the browser on Tizen sets |

**It fixes capabilities as well as syntax.** Lowering the floor also makes Next
inject core-js polyfills — the rebuilt bundle carries `Object.fromEntries`,
`Promise.allSettled`, `globalThis` and `flatMap`, which React's runtime assumes and
which downleveling alone would not have supplied. Verified by grepping the emitted
chunks, not assumed.

What it does NOT fix is anything the engine lacks at a lower level than a polyfill
can reach. `src/lib/stage/compat.ts` feature-detects what the stage itself needs,
and the ESLint fence over `src/app/(stage)/**` and `src/lib/stage/**` keeps our own
source from reaching for anything newer. If a real set still fails after this, the
remaining escape hatch is the one named in the plan: `public/stage/index.html` as
hand-written vanilla JS. Keeping the stage dependency-free is what keeps that port
mechanical.

**Verified after the change**, by fetching every chunk the stage loads: optional
chaining 38 → 0, logical assignment 1 → 0, optional catch 6 → 0. The single
remaining `??` is inside the regex literal `/()??/` in core-js's own feature
detection, not an operator.

**To find out what a set actually is:** load `/stage?ua=1` on it. That page is
rendered entirely on the server, so it prints the user-agent even when the bundle
cannot be parsed — the only diagnostic that survives this failure.
