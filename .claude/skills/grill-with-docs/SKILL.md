---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<input>
The ARGUMENTS value is the plan, feature, or topic to grill. Treat it as the starting point for the interview. If ARGUMENTS is empty or just "test", ask the user what they want to design or discuss before starting.
</input>

<what-to-do>

Interview me relentlessly about every aspect of the plan in ARGUMENTS until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

After each resolved decision:
- If a new domain term was defined or an existing one was clarified, update CONTEXT.md immediately using the CONTEXT.md format below.
- If the decision meets all three ADR criteria, offer to write an ADR using the ADR format below.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen.

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR.

---

## CONTEXT.md format

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## {Section heading — use when natural clusters emerge; omit for flat lists}

**TermName**:
{One or two sentence definition. What it IS, not what it does.}
_Avoid_: SynonymA, SynonymB

**AnotherTerm**:
{Definition.}
_Avoid_: AlternateName
```

Rules:
- Be opinionated: pick the best word, list the rest under `_Avoid_`.
- Definitions: one or two sentences max. No implementation details.
- Only include terms specific to this project's domain. General programming concepts don't belong.
- Group under subheadings only when natural clusters emerge.

**Single vs multi-context repos:**
- Single context (most repos): one `CONTEXT.md` at the repo root.
- Multiple contexts: a `CONTEXT-MAP.md` at the root lists the contexts, their paths, and how they relate.

---

## ADR format

ADRs live in `docs/adr/` with sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

```md
# {Short title of the decision}

{1–3 sentences: what's the context, what did we decide, and why.}

## Considered Options

- **Option A (chosen)**: reason
- **Option B**: why rejected

## Consequences

{Only include when non-obvious downstream effects need to be called out.}
```

Minimum viable ADR is just the title + 1–3 sentence body. Only add sections when they add genuine value.

**What qualifies for an ADR:**
- Architectural shape (monorepo, event-sourcing, etc.)
- Technology choices with meaningful lock-in (database, auth provider, deployment target)
- Boundary and scope decisions ("X is owned by context Y")
- Deliberate deviations from the obvious path
- Constraints not visible in the code
- Rejected alternatives whose rejection is non-obvious

Scan `docs/adr/` for the highest existing number and increment by one.

</supporting-info>
