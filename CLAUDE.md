# CLAUDE.md

Production engineering operating system for this repository.

This file defines the default execution pipeline for nvidia model. Skills are the
specialist execution layer; this file is the orchestration and quality-gate
layer. Do not treat the skill library as a menu of optional advice.

The goal is simple:

> Turn an implementation request into a verified, secure, maintainable,
> observable, production-ready change with the minimum necessary complexity.

---

# 1. Operating Mode

## Default behavior

Whenever the user asks to implement, build, modify, fix, refactor, launch, or
ship something, automatically run the appropriate production pipeline.

Do NOT wait for the user to explicitly say:

- "use skills"
- "make a plan"
- "write tests"
- "review this"
- "check security"
- "check performance"

Those are part of the default pipeline.

Do NOT blindly execute every installed skill. First classify the work, then
activate the relevant skills. Mandatory gates always run; specialist skills
run when their trigger conditions apply.

The user should be able to say:

    "Build X"

and nvidia model/Deepseek should orchestrate the full lifecycle without requiring the user
to manually chain skills.

---

# 2. Skill Stack

The installed skill ecosystem is intentionally layered.

## Primary engineering pipeline

**addyosmani/agent-skills**

This is the main software-engineering execution framework.

Use it for:

- requirements discovery
- specification
- planning
- implementation
- testing
- API/interface design
- frontend engineering
- debugging
- security
- performance
- code review
- simplification
- Git
- CI/CD
- documentation
- observability
- shipping

The lifecycle is:

    DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

The agent-skills pack contains 24 skills: 23 lifecycle skills plus the
`using-agent-skills` meta-skill.

### Core engineering skills

Define:

- using-agent-skills
- interview-me
- idea-refine
- spec-driven-development

Plan:

- planning-and-task-breakdown

Build:

- context-engineering
- source-driven-development
- doubt-driven-development
- frontend-ui-engineering
- api-and-interface-design
- test-driven-development
- incremental-implementation

Verify:

- browser-testing-with-devtools
- debugging-and-error-recovery

Review:

- code-review-and-quality
- code-simplification
- security-and-hardening
- performance-optimization

Ship:

- git-workflow-and-versioning
- ci-cd-and-automation
- deprecation-and-migration
- documentation-and-adrs
- observability-and-instrumentation
- shipping-and-launch

---
## Web quality pipeline

Use the installed `addyosmani/web-quality-skills` skills for web-facing
quality.

Relevant skills include:

- accessibility
- best-practices
- core-web-vitals
- performance
- SEO
- web-quality-audit

Also use the installed supporting web skills when applicable, including:

- SEO audits/strategy
- crawlability
- indexing
- sitemap
- robots.txt
- Open Graph
- local SEO
- programmatic SEO
- mobile friendliness
- image optimization
- website structure/navigation
- page generators
- Google Search Console

Web quality is not "nice to have" for production web work. It is a release
quality layer.

---

## Systematic debugging

Use:

`obra/superpowers/systematic-debugging`

as the preferred debugging methodology.

For failures, bugs, unexpected behavior, broken tests, runtime errors, or
regressions:

    DO NOT PATCH THE SYMPTOM FIRST.

Follow root-cause investigation before implementing a fix.

Required debugging flow:

    Reproduce
        ↓
    Gather evidence
        ↓
    Trace/localize
        ↓
    Form hypotheses
        ↓
    Test hypotheses
        ↓
    Identify root cause
        ↓
    Implement fix
        ↓
    Add regression protection
        ↓
    Verify

If three reasonable fix attempts fail, stop treating the problem as a local
bug and reassess the architecture/design.

---

## Caveman

Use `caveman` as a token-efficiency / communication optimization layer when
appropriate.

It does NOT replace engineering workflows.

It must never be used as justification to:

- skip investigation
- skip tests
- skip documentation
- skip security review
- skip verification
- compress away important requirements
- hide uncertainty

Concise execution is good. Missing engineering evidence is not.

---

# 3. MASTER PIPELINE

Every implementation request follows this lifecycle.

    USER REQUEST
         │
         ▼
    0. ORIENT / DISCOVER
         │
         ▼
    1. DEFINE
         │
         ▼
    2. ARCHITECT
         │
         ▼
    3. PLAN
         │
         ▼
    4. IMPLEMENT
         │
         ▼
    5. VERIFY
         │
         ▼
    6. HARDEN
         │
         ▼
    7. REVIEW
         │
         ▼
    8. PRODUCTIONIZE
         │
         ▼
    9. SHIP
         │
         ▼
    10. REPORT

A stage may activate multiple specialist skills.

A stage may also be skipped only when its trigger conditions genuinely do not
apply. The reason for skipping a normally expected gate must be recorded in
the final report.

---

# 4. STAGE 0 — ORIENT / DISCOVER

Before changing code:

1. Inspect the repository.
2. Read relevant project instructions.
3. Check `LESSONS.md` if present.
4. Inspect the existing architecture and affected code paths.
5. Determine whether this is greenfield, brownfield, bugfix, refactor, or
   production incident.
6. Determine the blast radius.
7. Identify relevant installed skills.
8. Identify constraints, dependencies, integrations, and external systems.

Use `using-agent-skills` to classify the work.

Use `context-engineering` to gather only the context needed for the task.

Use Graphify when available for architecture exploration and impact analysis.

Never invent repository structure or existing behavior.

---

# 5. STAGE 1 — DEFINE

## Requirements gate

For ambiguous or underspecified work:

    interview-me

Use one-question-at-a-time clarification until the requirements are sufficiently
understood.

For rough product/feature ideas:

    idea-refine

For a substantial feature/project:

    spec-driven-development

The specification should establish, where relevant:

- problem
- users
- goals
- non-goals
- user flows
- functional requirements
- acceptance criteria
- constraints
- architecture boundaries
- API/interface requirements
- data requirements
- security requirements
- testing requirements
- rollout/rollback considerations

Do not begin substantial implementation while important requirements remain
ambiguous.

For small, obvious changes, do not manufacture bureaucracy. Use judgment.

---

# 6. STAGE 2 — ARCHITECT

Before implementation, determine the technical shape of the change.

Activate:

- `api-and-interface-design` for APIs, contracts, modules, integrations, or
  public interfaces.
- `frontend-ui-engineering` for user-facing UI.
- `source-driven-development` when framework/library/API behavior matters.
- `doubt-driven-development` for high-risk, unfamiliar, irreversible, or
  architecturally significant decisions.
- `documentation-and-adrs` when an architectural decision is meaningful.

Architecture decisions must consider:

- existing conventions
- dependency boundaries
- data flow
- failure modes
- security boundaries
- backwards compatibility
- observability
- performance
- accessibility
- operational complexity
- migration/rollback

Prefer the smallest architecture that safely solves the actual problem.

---

# 7. STAGE 3 — PLAN

Run:

`planning-and-task-breakdown`

Produce small, independently verifiable implementation tasks.

Each task should contain:

- objective
- files/areas likely affected
- dependencies
- acceptance criteria
- verification command/check
- rollback consideration when relevant

Prefer vertical slices over giant implementation phases.

Avoid a plan that exists only as prose. It must translate directly into
executable work.

---

# 8. STAGE 4 — IMPLEMENT

Use:

- `incremental-implementation`
- `test-driven-development`

as the default implementation discipline.

For each meaningful task:

    Understand
       ↓
    Write/adjust test
       ↓
    Implement smallest change
       ↓
    Run targeted verification
       ↓
    Review result
       ↓
    Commit atomic change

Do not accumulate a huge unverified diff.

Do not say "tests later."

Do not create speculative abstractions.

Do not modify unrelated code unless required by the change.

Every changed line should have a reason.

---

# 9. CONDITIONAL SPECIALIST ROUTING

The following routing rules are mandatory.

## Frontend / UI

Activate:

- frontend-ui-engineering
- test-driven-development
- browser-testing-with-devtools
- web-quality skills as applicable
- performance-optimization
- security-and-hardening when user input/auth/data is involved

For user-facing UI, also evaluate:

- accessibility
- responsive/mobile behavior
- keyboard navigation
- loading states
- error states
- empty states
- reduced-motion behavior
- visual hierarchy
- Core Web Vitals
- SEO when publicly indexable

Never declare frontend work complete because the page "looks right."

---

## API / backend

Activate:

- api-and-interface-design
- source-driven-development when external APIs/framework behavior matter
- test-driven-development
- security-and-hardening
- observability-and-instrumentation
- performance-optimization when relevant

Verify:

- input validation
- authorization
- ownership checks
- error semantics
- status codes
- pagination
- rate limits
- idempotency
- timeouts
- retries
- logging
- metrics
- tracing where appropriate

---

## Authentication / authorization

Always activate:

- security-and-hardening
- api-and-interface-design
- test-driven-development
- doubt-driven-development for meaningful security decisions

Never trust frontend authorization.

Every protected mutation must enforce server-side authorization and resource
ownership.

---

## Payments / billing

Always activate:

- security-and-hardening
- api-and-interface-design
- test-driven-development
- observability-and-instrumentation
- doubt-driven-development
- documentation-and-adrs

Verify webhook signatures, idempotency, replay handling, entitlement state,
failure handling, and provider boundaries.

Never store raw card data.

---

## Database / schema changes

Evaluate:

- api-and-interface-design
- deprecation-and-migration
- test-driven-development
- security-and-hardening
- observability-and-instrumentation

Consider:

- existing data
- backwards compatibility
- migration safety
- rollback
- indexes
- constraints
- RLS/authorization
- deployment ordering

Never assume a schema change is safe because it works on an empty database.

---

## External integrations

Activate:

- source-driven-development
- api-and-interface-design
- security-and-hardening
- observability-and-instrumentation
- test-driven-development

Read authoritative documentation for the exact version/API behavior before
making framework or integration decisions.

Do not rely on remembered API behavior when documentation can verify it.

---

## Bug / regression

Activate:

- systematic-debugging
- test-driven-development
- debugging-and-error-recovery

Required:

1. Reproduce.
2. Capture evidence.
3. Identify root cause.
4. Add/adjust regression test.
5. Fix root cause.
6. Verify adjacent behavior.

Never repeatedly patch symptoms.

---

## Performance work

Activate:

- performance-optimization
- web-quality `performance`
- web-quality `core-web-vitals`
- browser-testing-with-devtools for browser-facing behavior

Measure before optimizing.

Record the before/after evidence.

Do not claim performance improvements without measurements.

---

## SEO / public web

Activate relevant:

- web-quality `seo`
- `seo-audit`
- `seo-strategy`
- `site-crawlability`
- `indexing`
- `robots-txt`
- `xml-sitemap`
- `open-graph`
- `website-structure`
- `mobile-friendly`
- `image-optimization`

Use marketing SEO skills when the task is strategic/content/growth-oriented.

Technical SEO and marketing SEO should complement each other rather than
duplicating work.

---

## Marketing / growth

Activate relevant skills from:

- `kostja94/marketing-skills`
- `coreyhaines31/marketingskills`

Potential domains:

- product marketing
- positioning
- messaging
- landing-page copy
- CRO
- onboarding
- pricing
- email
- social
- content
- SEO
- acquisition
- analytics
- launch
- retention

Do not automatically activate marketing skills for purely technical work.

For a product-facing feature, evaluate whether the feature changes:

- value proposition
- activation
- conversion
- onboarding
- pricing
- retention
- acquisition
- messaging

If yes, route the relevant marketing work after the product/technical intent
is understood.

---

# 10. STAGE 5 — VERIFY

Verification is evidence, not confidence.

Run the narrowest relevant checks first, then broader checks.

Typical sequence:

    targeted test
        ↓
    typecheck
        ↓
    lint
        ↓
    build
        ↓
    integration tests
        ↓
    E2E/browser verification
        ↓
    production-specific checks

Use:

- `test-driven-development`
- `browser-testing-with-devtools`
- `debugging-and-error-recovery`

when applicable.

For browser work, inspect:

- console
- network requests
- runtime errors
- DOM behavior
- responsive layouts
- accessibility behavior
- loading/error states
- performance

Do not trust screenshots alone.

---

# 11. STAGE 6 — HARDEN

Before calling a substantial change production-ready, run the applicable
hardening layers.

## Security

`security-and-hardening`

Check:

- authentication
- authorization
- ownership
- input validation
- injection
- secrets
- CSRF/CORS
- headers
- rate limiting
- SSRF
- XSS
- dependency risk
- sensitive data exposure
- webhook verification
- logging hygiene

Never log:

- API keys
- access tokens
- refresh tokens
- passwords
- private keys
- payment secrets

---

## Web quality

For web-facing work, evaluate:

- accessibility
- Core Web Vitals
- performance
- SEO
- mobile friendliness
- best practices

Use the installed web-quality skills rather than reinventing audits.

---

## Observability

`observability-and-instrumentation`

For production behavior, consider:

- structured logs
- useful error context
- RED metrics
- latency
- error rate
- traffic
- tracing
- health checks
- symptom-based alerts

Instrument important paths while building, not after an incident.

---

# 12. STAGE 7 — REVIEW

Run:

- `code-review-and-quality`
- `code-simplification`

For significant/high-risk changes also use:

- `doubt-driven-development`
- relevant specialist personas if available

Review for:

1. Correctness
2. Security
3. Reliability
4. Maintainability
5. Performance

Then simplify.

Use the Chesterton's Fence principle before changing unfamiliar behavior.

Do not "clean up" unrelated code.

---

# 13. STAGE 8 — PRODUCTIONIZE

Before shipping, verify:

- tests pass
- build passes
- lint/typecheck pass
- migrations are safe
- environment variables are documented
- secrets are not committed
- logging is safe
- observability exists for critical paths
- error handling is production-safe
- rollback is understood
- feature flags are used when warranted
- documentation is updated
- CI/CD gates are configured when relevant

Activate:

- `ci-cd-and-automation`
- `documentation-and-adrs`
- `observability-and-instrumentation`
- `shipping-and-launch`

For migrations/deprecations:

- `deprecation-and-migration`

---

# 14. STAGE 9 — SHIP

Use:

`git-workflow-and-versioning`

and:

`shipping-and-launch`

Default Git behavior:

- small atomic commits
- imperative commit messages
- `feat/`, `fix/`, `chore/` branches when branches are used
- commit after a verified logical slice
- never commit secrets
- never commit generated artifacts unless intentionally tracked

Do not bundle unrelated work into one commit.

Before production deployment, establish:

- what is changing
- how it is verified
- how it is monitored
- how it is rolled back

---

# 15. PRODUCTION READINESS GATE

A change is NOT "done" merely because the code works locally.

Before declaring production-ready, verify applicable categories:

## Requirements

- [ ] Requirements understood
- [ ] Acceptance criteria satisfied
- [ ] Non-goals respected

## Architecture

- [ ] Existing architecture respected
- [ ] Interfaces/contracts defined
- [ ] No unnecessary complexity
- [ ] Important decisions documented

## Code

- [ ] Implementation complete
- [ ] No speculative features
- [ ] No unrelated refactors
- [ ] Types are correct

## Testing

- [ ] Tests cover critical behavior
- [ ] Regression tests exist for bugs
- [ ] Relevant integration/E2E tests pass
- [ ] Build/typecheck/lint pass

## Security

- [ ] Inputs validated
- [ ] Authorization enforced
- [ ] Ownership checked
- [ ] Secrets protected
- [ ] Sensitive data not leaked
- [ ] External/webhook boundaries secured

## UX / Web

- [ ] Loading states
- [ ] Error states
- [ ] Empty states
- [ ] Mobile/responsive behavior
- [ ] Accessibility
- [ ] Performance
- [ ] SEO where applicable

## Operations

- [ ] Logs useful and safe
- [ ] Critical metrics available
- [ ] Errors observable
- [ ] Rollback understood
- [ ] CI/CD appropriate

## Documentation

- [ ] Relevant docs updated
- [ ] ADR added when appropriate
- [ ] README updated when behavior/setup changes
- [ ] Lessons captured when a meaningful failure/gotcha occurred

If a critical applicable item fails, do not claim production-ready.

---

# 16. QUALITY GATES ARE LOOPS

When a gate fails:

    FAIL
      ↓
    Diagnose
      ↓
    Fix
      ↓
    Re-run affected verification
      ↓
    Re-enter gate

Do not continue past a failed critical gate merely because the remaining
pipeline is easier to execute.

For debugging, use systematic-debugging before making speculative fixes.

---

# 17. RISK-BASED ESCALATION

Not every task deserves the same amount of ceremony.

## Small / low-risk

Examples:

- typo
- isolated UI copy
- tiny styling adjustment
- obvious one-line fix

Use:

    orient → implement → verify → review

## Medium

Examples:

- feature spanning multiple files
- API change
- database change
- significant UI
- integration

Use the full:

    define → architect → plan → implement → verify → harden → review → ship

## High-risk

Examples:

- auth
- payments
- destructive migrations
- security-sensitive code
- production incidents
- major architecture
- irreversible data operations

Additionally activate:

- doubt-driven-development
- source-driven-development
- systematic-debugging where relevant
- extra verification
- explicit rollback planning

Never trade correctness for speed on high-risk changes.

---

# 18. MARKETING + ENGINEERING CONVERGENCE

For product work, technical implementation and product growth should inform
each other, but remain separate concerns.

Example:

    "Add a new onboarding flow"

Engineering:
spec
UX architecture
API/data changes
implementation
tests
security
browser testing
performance
observability

Marketing/growth:
activation goal
messaging
friction reduction
conversion hypothesis
analytics events
experiment design
copy

Then converge on:

    one acceptance model
    one implementation
    one verification plan

Do not allow marketing copy or growth assumptions to silently become product
requirements without validation.

---

# 19. WEB QUALITY + ENGINEERING CONVERGENCE

For public web changes:

    Product intent
        ↓
    Frontend engineering
        ↓
    Accessibility
        ↓
    Performance / CWV
        ↓
    SEO
        ↓
    Browser verification
        ↓
    Production review

A page can be visually excellent and still fail accessibility, performance,
SEO, or runtime checks.

All applicable dimensions must be considered.

---

# 20. SOURCE-OF-TRUTH RULE

When skills disagree:

1. Prefer project-specific requirements.
2. Prefer authoritative framework/library documentation for factual API
   behavior.
3. Prefer the most task-specific specialist skill.
4. Prefer security requirements over convenience.
5. Prefer verified repository behavior over assumptions.
6. Resolve contradictions explicitly.

Never blindly merge conflicting instructions.

---

# 21. ANTI-RATIONALIZATION RULES

Never use these excuses:

> "I'll add tests later."

No. Add the appropriate tests now.

> "It's just a small change."

If behavior changes, verify behavior.

> "The UI looks correct."

Run browser/runtime checks.

> "The API probably works this way."

Verify official documentation.

> "Security isn't relevant."

Classify the trust boundary first.

> "We can optimize later."

Measure whether performance is actually acceptable before shipping.

> "This is only a prototype."

If it is going to production, apply production gates.

> "The skill is optional."

Only skip it when its trigger genuinely does not apply.

> "The existing code is messy, so I'll rewrite it."

No. Make the smallest safe change unless refactoring is part of the task.

> "Three fixes didn't work, I'll try another patch."

Stop. Investigate architecture/root cause.

---

# 22. EXISTING PROJECT STACK

The following reflects the currently documented project environment. Verify
against the repository before making technology assumptions.

Frontend:

- Next.js App Router
- TypeScript strict
- Tailwind CSS
- Radix UI
- shadcn/ui
- Recharts

Backend/data:

- Supabase
- PostgreSQL
- Supabase Auth
- RLS
- AES-256 encryption where application-level credential encryption is required

Hosting:

- Vercel frontend
- Render worker

Integrations:

- Resend
- Dodo Payments
- Supabase Auth

Tooling:

- Biome/ESLint
- Graphify

Do not introduce a replacement technology simply because it is preferred
personally. Match the existing architecture unless the task requires a change.

---

# 23. CODING STANDARDS

- TypeScript everywhere where applicable.
- Strict typing.
- Avoid `any`.
- Next.js App Router, not Pages Router.
- Server Components by default.
- `"use client"` only when required.
- Tailwind for styling.
- Existing component/design-system primitives should be reused.
- Mobile-first responsive behavior.
- Minimum comfortable touch targets for interactive mobile UI.
- Validate external/user input at trust boundaries.
- Keep APIs consistent with existing project contracts.
- Use clear names over clever abstractions.
- Prefer simple code over generalized frameworks.
- Keep functions/components focused.
- Do not introduce abstractions for one use case unless they clearly improve
  correctness or maintainability.

---

# 24. SECURITY BASELINE

These are non-negotiable unless the architecture explicitly makes one
inapplicable.

- Never log secrets.
- Never commit secrets.
- Validate input at system boundaries.
- Enforce authorization server-side.
- Check resource ownership on mutations.
- Enable database-level isolation where applicable.
- Use HTTPS in production.
- Restrict CORS to known origins where CORS is needed.
- Verify webhook signatures.
- Never store raw payment card data.
- Rate-limit authentication and abuse-prone endpoints.
- Do not expose internal stack traces to users.
- Do not return sensitive credentials in API responses.
- Use least privilege for service credentials.
- Review dependencies when security-sensitive changes are made.

---

# 25. ERROR HANDLING

- Errors should fail safely.
- User-facing errors should be actionable.
- Never expose server stack traces.
- Preserve useful diagnostic context in internal logs.
- Third-party failures should be isolated where appropriate.
- Async UI must have loading/error states.
- Critical production paths must be observable.
- Retries must be bounded and appropriate.
- Avoid retry storms.
- Use idempotency for operations where duplicate execution is dangerous.

---

# 26. WORKER / BACKGROUND JOB RULES

Where workers exist:

- Keep workers restart-safe.
- Prefer stateless workers.
- Persist state in durable storage.
- Make operations idempotent.
- Handle each external integration independently.
- Do not let one integration crash the entire processing loop.
- Enforce business/tier limits server-side.
- Track state needed to prevent duplicate notifications/work.
- Use bounded retries and backoff.
- Instrument job duration, success/failure, and backlog where relevant.

---

# 27. VERCEL MIDDLEWARE

If `middleware.ts` exists, verify that routing scope is intentional.

Do not create a broad middleware matcher accidentally.

Every middleware invocation should have a reason to run.

Before shipping middleware changes, verify:

- matcher scope
- static asset exclusion where appropriate
- auth behavior
- cache behavior
- runtime compatibility
- performance impact

---

# 28. GRAPHIFY

When Graphify is installed and useful:

1. Build/update the knowledge graph at project start or after major structural
   changes.
2. Use it for architecture exploration and impact analysis.
3. Use path/explain queries before changing unfamiliar cross-cutting code.
4. Keep generated output out of Git unless intentionally required.

Keep:

    /graphify-out

in `.gitignore`.

---

# 29. LESSONS.md

If `LESSONS.md` exists:

Read it at the start of relevant sessions.

After a meaningful failure, production issue, repeated mistake, or discovered
repository-specific gotcha, record a concise lesson.

Use:

- date
- category
- what happened
- root cause
- fix
- prevention

Do not fill the file with trivial observations.

---

# 30. DOCUMENTATION OUTPUT MAP

The repository has a canonical `docs/` tree. Treat it as the single home for
AI-generated project documentation and planning artifacts.

Do NOT scatter generated Markdown documentation across the repository root,
random feature folders, or source directories when a canonical `docs/` location
exists.

Before creating a document, determine its purpose and place it in the most
specific applicable directory below.

## Canonical locations

```text
docs/
├── architecture/       # System architecture and technical design
├── audits/              # Security, quality, performance, and periodic audits
│   ├── periodic/
│   └── security/
├── decisions/           # Architecture Decision Records (ADRs)
├── design/              # Product/UI/UX design system and design documentation
├── features/            # Feature-specific documentation
├── foundation/          # Product foundation: vision, ICP, positioning, problem
├── growth/              # Growth experiments, launch plans, growth strategy
├── market/              # Market, competitive, GTM research
├── migrations/          # Migration and deprecation documentation
├── operations/          # Legal, compliance, operational metrics
├── product/             # PRDs, roadmap, feature templates
├── reasonix/             # Agent-generated execution artifacts
│   ├── plans/
│   └── specs/
└── testing/             # Testing strategy, notes, and test documentation
```

## Routing rules

### Architecture

Put:

- architecture overviews
- system architecture
- technical architecture
- data-flow documentation
- non-functional requirements
- technology stack decisions

in:

`docs/architecture/`

Examples:

```text
docs/architecture/architecture-overview.md
docs/architecture/nonfunctional-requirements.md
docs/architecture/tech-stack.md
```

---

### Product requirements

Put:

- PRDs
- product requirements
- roadmap changes
- feature requirements
- acceptance-oriented product documentation

in:

`docs/product/`

Examples:

```text
docs/product/PRD.md
docs/product/roadmap.md
```

For a feature-specific PRD, prefer:

`docs/product/features/<feature-name>.md`

only if that structure is already supported by the repository. Otherwise use
the existing `docs/features/` area for feature-specific documentation.

---

### Feature documentation

Put implementation-specific feature documentation in:

`docs/features/`

Examples:

```text
docs/features/<feature-name>.md
docs/features/<feature-name>-implementation.md
docs/features/<feature-name>-rollout.md
```

Do not create a new top-level documentation category for an individual feature.

---

### Agent-generated specifications

Use:

`docs/reasonix/specs/`

for implementation specifications produced during the agent workflow.

Examples:

```text
docs/reasonix/specs/<feature-name>.md
docs/reasonix/specs/<feature-name>-v2.md
```

A specification should contain the technical execution contract needed by the
implementation pipeline.

Do not confuse an execution specification with the canonical product PRD.
Product-level requirements belong under `docs/product/`.

---

### Agent-generated plans

Use:

`docs/reasonix/plans/`

for implementation plans generated by the planning stage.

Examples:

```text
docs/reasonix/plans/<feature-name>.md
docs/reasonix/plans/<feature-name>-implementation.md
```

Plans should contain:

- task breakdown
- dependency ordering
- acceptance criteria
- verification steps
- rollout considerations
- implementation sequencing

The plan is an execution artifact, not a replacement for the PRD.

---

### Architecture Decision Records

Use:

`docs/decisions/`

for durable architectural decisions.

Follow the repository's existing ADR template:

```text
docs/decisions/0001-template.md
```

Create the next sequential ADR number rather than inventing arbitrary names.

Examples:

```text
docs/decisions/0002-use-r2-for-object-storage.md
docs/decisions/0003-background-job-architecture.md
```

Create an ADR when a decision has meaningful long-term architectural
consequences, tradeoffs, or reversibility concerns.

Do not create an ADR for every implementation detail.

---

### Design / UI / UX

Put:

- design specifications
- design-system decisions
- UI/UX architecture
- interaction patterns
- visual design documentation

in:

`docs/design/`

Use the existing:

`docs/design/DESIGN.md`

as the canonical design reference when applicable.

For user-facing implementation, keep design intent here and implementation
details in the relevant feature/spec documentation.

---

### Testing

Put:

- testing strategy
- test plans
- testing notes
- manual QA procedures
- test environment documentation

in:

`docs/testing/`

Examples:

```text
docs/testing/testing-notes.md
docs/testing/<feature-name>-test-plan.md
```

Do not put actual automated test source files in `docs/`; tests belong in the
repository's normal test/source structure.

---

### Security and quality audits

Put:

- security audits
- OWASP reviews
- dependency/security reviews
- accessibility audits
- performance audits
- web-quality audits
- periodic engineering audits

in:

`docs/audits/`

Security-specific audits go in:

`docs/audits/security/`

Recurring/periodic audits go in:

`docs/audits/periodic/`

Examples:

```text
docs/audits/security/2026-08-auth-audit.md
docs/audits/security/<feature-name>-security-review.md
docs/audits/periodic/2026-08-web-quality-audit.md
```

Do not overwrite historical audits unless explicitly instructed.

---

### Migrations and deprecations

Put:

- database migrations documentation
- data migrations
- API migrations
- deprecation plans
- backwards-compatibility notes
- rollout/rollback migration procedures

in:

`docs/migrations/`

**This project's rule (2026-08-13):** migration **files** (the actual SQL)
live under `docs/migrations/` — the agent keeps all durable artifacts,
including database migrations, inside the docs tree. `agent/src/.../db.py`
reads its migration directory from `docs/migrations/`. The generic guidance
below (code migrations staying with tooling) does not apply here; the
repository convention wins.

---

### Operations

Put:

- operational procedures
- legal/compliance documentation
- production metrics definitions
- incident/operational guidance

in:

`docs/operations/`

Keep secrets, credentials, private keys, and sensitive production data out of
documentation.

---

### Foundation

Put durable product-foundation documents in:

`docs/foundation/`

Examples:

```text
docs/foundation/vision.md
docs/foundation/problem-statement.md
docs/foundation/icp.md
docs/foundation/positioning.md
docs/foundation/business-model.md
```

These documents define product context that downstream product, engineering,
marketing, and growth decisions may rely on.

Do not rewrite foundation documents casually during feature implementation.

Update them only when the feature materially changes the underlying product
assumptions.

---

### Market

Put:

- competitive analysis
- market research
- go-to-market strategy
- market positioning research

in:

`docs/market/`

Use this when research informs product or business decisions.

---

### Growth

Put:

- growth experiments
- experiment results
- launch plans
- growth strategy
- experiment logs

in:

`docs/growth/`

Examples:

```text
docs/growth/experiments-log.md
docs/growth/launch-plan.md
```

Marketing skills should write durable strategy/artifacts here rather than
creating ad-hoc Markdown files elsewhere.

---

# 38. DOCUMENTATION LIFECYCLE

Documentation is part of the implementation pipeline.

Use this mapping:

```text
DISCOVER
   ↓
docs/foundation/       ← only when product context changes
docs/market/           ← research when needed

DEFINE
   ↓
docs/product/          ← PRD / product requirements
docs/features/         ← feature context
docs/reasonix/specs/   ← execution specification

ARCHITECT
   ↓
docs/architecture/     ← architecture documentation
docs/design/           ← UI/UX design
docs/decisions/        ← durable architectural decisions

PLAN
   ↓
docs/reasonix/plans/   ← implementation plan

IMPLEMENT
   ↓
source code + tests
   ↓
docs/features/         ← durable feature documentation when useful

VERIFY / HARDEN
   ↓
docs/testing/          ← testing notes/plans
docs/audits/security/  ← security audit
docs/audits/           ← quality/performance/accessibility audits

MIGRATE
   ↓
docs/migrations/

OPERATE
   ↓
docs/operations/

GROW / LAUNCH
   ↓
docs/growth/
docs/market/

SHIP
   ↓
update affected canonical docs
```

Do not create every possible document for every task. Create documentation
when the task or its quality gates require it.

---

# 39. DOCUMENTATION DECISION RULE

Before writing a Markdown document, ask:

1. Is this durable project knowledge?
2. Is there already a canonical document for this information?
3. Which `docs/` category owns it?
4. Is this an execution artifact or permanent project documentation?
5. Will another agent need this later?

If an existing document is the correct home, update it instead of creating a
duplicate.

Prefer:

    update canonical document

over:

    create another similar document

---

# 33. DOCUMENT NAMING

Use:

- lowercase kebab-case for new filenames
- descriptive names
- stable names for canonical documents
- dates for historical audit records where useful
- sequential numbers for ADRs

Examples:

```text
feature-name.md
feature-name-test-plan.md
2026-08-security-audit.md
0007-background-job-retry-policy.md
```

Avoid:

```text
final.md
new.md
notes2.md
latest.md
stuff.md
ai-output.md
temp.md
```

Never create files such as:

```text
docs/final-final.md
docs/new-architecture.md
docs/plan-v2-final.md
```

without a meaningful reason.

---

# 34. DOCUMENT UPDATE RULES

When implementation changes invalidate existing documentation:

1. Identify the canonical document.
2. Update it as part of the same task.
3. Search for contradictory stale documentation when the change is
   architectural or externally visible.
4. Do not leave two documents describing different realities.

Documentation must describe the system that actually exists.

Do not document planned behavior as implemented behavior.

Use explicit status labels when useful:

- Proposed
- In Progress
- Implemented
- Deprecated
- Superseded

---

# 35. EXECUTION ARTIFACT RETENTION

`docs/reasonix/` is for agent execution artifacts.

Use:

```text
docs/reasonix/specs/
docs/reasonix/plans/
```

for specifications and plans that are useful to future agents or humans.

Once implementation is complete:

- keep the plan if it provides useful historical/contextual value
- keep the specification if it is useful as an implementation contract
- update canonical product/architecture documentation where appropriate
- do not duplicate the same content across multiple files merely for
  completeness

The execution plan is not automatically the source of truth after the code
changes. The code plus canonical project documentation are the source of truth.

---

# 36. DOCUMENTATION QUALITY GATE

Before completing a substantial task, check:

- [ ] New durable knowledge has a canonical location.
- [ ] Existing canonical docs were updated when necessary.
- [ ] No duplicate documentation was created unnecessarily.
- [ ] Plans/specs are under `docs/reasonix/`.
- [ ] ADRs are under `docs/decisions/`.
- [ ] Audits are under `docs/audits/`.
- [ ] Testing documentation is under `docs/testing/`.
- [ ] Migration documentation is under `docs/migrations/`.
- [ ] Product documentation is under `docs/product/`.
- [ ] Feature documentation is under `docs/features/`.
- [ ] Architecture documentation is under `docs/architecture/`.
- [ ] Design documentation is under `docs/design/`.
- [ ] Growth/marketing artifacts are under `docs/growth/` or `docs/market/`.
- [ ] Operational documentation is under `docs/operations/`.
- [ ] No secrets or sensitive production data were written to docs.
- [ ] Documentation does not claim behavior that the implementation does not
      actually provide.

---

# 37. AI CONFIG SYNCHRONIZATION

If this repository intentionally maintains multiple agent instruction files,
keep them synchronized when changing project-wide engineering rules.

Potential files:

- `CLAUDE.md`
- `AGENTS.md`
- `.cursorrules`
- `.windsurfrules`
- `GEMINI.md`

Do not blindly overwrite agent-specific configuration. Preserve each tool's
native structure while keeping the project rules consistent.

---

# 38. FINAL RESPONSE CONTRACT

After completing implementation, report concisely:

## Implemented

What changed.

## Skills activated

Only the meaningful specialist skills used.

## Verification

Exact checks run and their results.

Example:

    ✓ pnpm lint
    ✓ pnpm typecheck
    ✓ pnpm test
    ✓ pnpm build
    ✓ Browser smoke test
    ✓ Accessibility check

## Security

Relevant security checks and findings.

## Performance / Web Quality

Relevant measurements or audits.

## Remaining risks

Anything intentionally not verified or any known limitation.

## Production status

Use exactly one:

    READY TO SHIP

or

    NOT READY TO SHIP

Never say "production-ready" when a critical applicable gate is unresolved.

---

# 39. THE ONE-LINE RULE

The user should be able to say:

    "Implement <feature></feature>"

and nvidia model/Deepseek should automatically:

    understand
      → specify
      → architect
      → plan
      → implement
      → test
      → debug
      → audit
      → review
      → document
      → instrument
      → ship

while dynamically activating the installed engineering, marketing, debugging,
and web-quality skills that actually apply.

The objective is not maximum process.

The objective is maximum verified production quality with minimum unnecessary
work.

Each feature, bugfix, update MUST be done by creating a new branch and never touching the main production branch.

# 40. CLOUDFLARE ENGINEERING RULES

When building, deploying, configuring, or debugging anything involving Cloudflare, treat the installed Cloudflare Agent Skills as the authoritative implementation guidance.

The project currently uses Cloudflare for the marketing-site infrastructure and may use additional Cloudflare services when requirements justify them.

## Cloudflare Skill Usage

Before implementing Cloudflare-specific functionality:

1. Identify which installed Cloudflare skill applies.
2. Load/use the relevant skill rather than relying on general model knowledge.
3. Prefer current Cloudflare documentation for APIs, configuration, limits, pricing, compatibility, and deprecated/replaced functionality.
4. Inspect the project's actual Wrangler configuration, package versions, bindings, and runtime before making assumptions.
5. Verify the implementation against the current Cloudflare documentation before declaring it production-ready.

Do NOT assume that a Cloudflare API, configuration field, runtime behavior, pricing tier, limit, or product capability is current based solely on model knowledge.

## Cloudflare Skill Routing

Use the most specific installed skill available.

### General Cloudflare Architecture

Use the `cloudflare` skill when:

- choosing between Cloudflare products
- designing Cloudflare architecture
- evaluating Workers vs other Cloudflare compute options
- deciding between KV, D1, R2, Durable Objects, Queues, etc.
- working with Cloudflare networking/security
- evaluating Cloudflare infrastructure options
- making Cloudflare-specific architectural decisions

Do not choose a Cloudflare product simply because it exists. First determine the actual requirement, then use the Cloudflare skill's decision guidance to select the appropriate primitive.

### Workers

Use the relevant Workers skills when:

- creating a Worker
- adding Worker routes
- implementing server-side/edge logic
- configuring Worker bindings
- deploying Worker code
- debugging Worker runtime behavior

Prefer the current Workers APIs and patterns documented by Cloudflare.

### Wrangler

Use the `wrangler` skill for:

- `wrangler.jsonc` / `wrangler.toml`
- local development
- deployments
- bindings
- environment configuration
- migrations
- secrets
- Cloudflare resource management
- deployment troubleshooting

Before modifying Wrangler configuration:

1. inspect the existing configuration
2. inspect installed Wrangler/package versions
3. understand existing bindings/environments
4. make the smallest necessary change
5. validate the resulting configuration

Never overwrite existing bindings or environment configuration without checking what they are used for.

### Cloudflare Storage

Use the relevant Cloudflare skills when working with:

- R2
- KV
- D1
- Durable Objects
- Queues
- other Cloudflare storage/data primitives

Do not substitute one Cloudflare storage product for another without first checking its consistency, durability, access pattern, size, latency, and cost requirements.

General guidance:

- **R2** → object/blob storage
- **KV** → globally distributed key/value configuration/cache-like data
- **D1** → SQLite-based relational data when D1 is actually appropriate
- **Durable Objects** → strongly coordinated stateful objects
- **Queues** → asynchronous message/job processing

The exact choice must come from requirements, not this list alone.

### Durable Objects

Use the `durable-objects` skill when the feature requires:

- stateful coordination
- strongly consistent per-object state
- WebSockets
- real-time collaboration
- rooms/sessions
- coordination between requests
- alarms
- stateful actors

Do not introduce Durable Objects merely because they are available.

### Web Performance

Use the Cloudflare `web-perf` skill for performance-sensitive web work, especially when evaluating:

- Core Web Vitals
- LCP
- INP
- CLS
- render-blocking resources
- network chains
- asset loading
- third-party scripts
- Cloudflare delivery behavior

Combine this with the project's existing Web Quality Skills.

Cloudflare performance guidance does not replace the project's broader accessibility, SEO, Core Web Vitals, and web-quality gates.

### Turnstile

Use the Cloudflare Turnstile skill when implementing:

- bot protection
- human verification
- signup protection
- form protection
- suspicious-action challenges
- abuse mitigation

Turnstile verification MUST happen server-side.

Never treat a client-side "success" state as sufficient proof that a request is legitimate.

Refer to `docs/anti-abuse.md` for the project's broader anti-abuse strategy.

### Cloudflare Security

Use the relevant Cloudflare security skills when working with:

- WAF
- DDoS protection
- Bot Management
- rate limiting
- security rules
- access controls
- suspicious traffic
- abuse mitigation

Security controls should be layered:

```text
Cloudflare Edge
    ↓
WAF / security rules
    ↓
Rate limiting
    ↓
Application
    ↓
Authentication
    ↓
Authorization
    ↓
Application-level validation
```

Do not assume Cloudflare security controls replace application-level authentication, authorization, validation, or abuse protection.

### Cloudflare One / Networking

Use the appropriate Cloudflare One skills when working with:

- Zero Trust
- Access
- tunnels
- private networking
- identity-aware access
- internal services
- network security

Do not expose internal infrastructure publicly when a private-access pattern is more appropriate.

### AI / Agents

If the project ever requires Cloudflare AI or agent infrastructure, use the specific Cloudflare skills:

- `agents-sdk`
- `building-ai-agent-on-cloudflare`
- `sandbox-sdk`
- relevant Workers AI / Vectorize guidance
- `building-mcp-server-on-cloudflare`

Do not assume the project needs Cloudflare's AI infrastructure. Only introduce it when the actual requirements justify it.

### MCP

Use `building-mcp-server-on-cloudflare` when building a remote MCP server on Cloudflare.

Use the appropriate Cloudflare MCP tooling when it materially improves verification or implementation.

## Cloudflare Documentation Rule

Cloudflare APIs and products change quickly.

For any implementation involving Cloudflare, verify current documentation before relying on:

- API signatures
- SDK methods
- Wrangler configuration fields
- binding syntax
- runtime APIs
- compatibility dates
- feature availability
- pricing
- quotas
- limits
- deployment behavior
- product names
- deprecated APIs

If project documentation conflicts with current Cloudflare documentation:

1. verify the current official Cloudflare documentation
2. determine whether the project is intentionally pinned to an older version
3. inspect package/runtime versions
4. update the implementation if appropriate
5. update project documentation if the architecture changed

Never silently continue with stale Cloudflare guidance.

## Cloudflare Version Awareness

Before making a Cloudflare-specific implementation:

```text
Inspect package.json
        ↓
Inspect lockfile
        ↓
Inspect Wrangler configuration
        ↓
Inspect existing bindings
        ↓
Inspect runtime / compatibility settings
        ↓
Consult current Cloudflare docs
        ↓
Implement
        ↓
Run validation
```

Do not blindly upgrade Cloudflare dependencies while implementing an unrelated feature.

Dependency upgrades require their own justification and verification.

## Cloudflare Configuration Safety

Treat these as infrastructure configuration:

- `wrangler.jsonc`
- `wrangler.toml`
- Worker bindings
- environment variables
- secrets
- routes
- domains
- Cloudflare account/zone configuration
- R2 buckets
- KV namespaces
- D1 databases
- Durable Object bindings
- Queues
- Workers deployments

Before modifying them:

1. inspect the current state
2. understand what depends on it
3. make the smallest safe change
4. validate locally
5. verify the resulting configuration
6. document durable architectural changes

Never delete or replace existing bindings/configuration without understanding their purpose.

## Cloudflare Environment Separation

Maintain clear separation between:

```text
Development
Preview
Production
```

Where supported, use separate:

- resources
- bindings
- secrets
- storage
- databases
- configuration

Never point local development or preview deployments at production resources unless explicitly required and reviewed.

## Cloudflare Secrets

Never commit:

- Cloudflare API tokens
- API keys
- R2 credentials
- service tokens
- authentication secrets
- Worker secrets
- third-party secrets

Use the appropriate environment/deployment secret mechanism.

Never expose server-side Cloudflare credentials to the browser.

## Cloudflare Deployment Verification

A Cloudflare deployment is not complete merely because the deploy command succeeds.

After deployment, verify:

1. deployment succeeded
2. expected environment is deployed
3. expected bindings exist
4. production/preview URL responds
5. important routes work
6. assets load correctly
7. security headers/configuration remain correct
8. logs show no unexpected errors
9. performance remains within budget
10. rollback remains possible

For production changes, use the relevant Cloudflare observability tooling where available.

## Cloudflare Observability

When debugging a Cloudflare-hosted system, use the relevant Cloudflare observability capabilities rather than guessing from client-side symptoms.

Investigate:

- Worker logs
- request failures
- deployment state
- runtime errors
- binding errors
- latency
- traffic
- Cloudflare analytics
- relevant security events

Debugging flow:

```text
Observe
 ↓
Reproduce
 ↓
Inspect Cloudflare/runtime state
 ↓
Inspect application state
 ↓
Form hypothesis
 ↓
Test hypothesis
 ↓
Fix root cause
 ↓
Verify
```

Use the project's `systematic-debugging` skill for difficult failures.

## Cloudflare + Project Architecture

Current intended architecture:

```text
                    INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
   MARKETING SITE              APPLICATION
       Astro                    Next.js
          │                         │
          ▼                         ▼
     Cloudflare                   Vercel
          │                         │
          │                ┌────────┼────────┐
          │                │        │        │
          │                ▼        ▼        ▼
          │              Neon    Neon Auth   R2
          │
          └──────────── Cloudflare services
                         when justified
```

The marketing site should remain Cloudflare-first.

Cloudflare services should be added to the application only when there is a clear architectural reason.

Do not introduce Cloudflare-specific infrastructure merely for novelty.

## Cloudflare Product Selection Rule

Before introducing a Cloudflare product, answer:

```text
What requirement does this solve?
        ↓
What are the available architectural options?
        ↓
Why is Cloudflare the appropriate option?
        ↓
Which Cloudflare primitive fits the workload?
        ↓
What trade-offs are accepted?
        ↓
How will it be tested and operated?
```

Record significant decisions in:

```text
docs/decisions/
```

Update:

```text
docs/architecture/
```

when the durable architecture changes.

## Cloudflare Quality Gate

Before declaring a Cloudflare-related feature production-ready:

- [ ] Correct Cloudflare skill used
- [ ] Current Cloudflare documentation checked
- [ ] Existing configuration inspected
- [ ] Correct product selected for the requirement
- [ ] Wrangler/configuration validated
- [ ] Secrets protected
- [ ] Environment separation verified
- [ ] Relevant security controls verified
- [ ] Relevant tests pass
- [ ] Deployment verified
- [ ] Runtime/logs checked
- [ ] Performance checked where relevant
- [ ] Rollback understood
- [ ] Architecture documentation updated when necessary
- [ ] ADR created when the decision is durable

## Cloudflare Anti-Hallucination Rule

When uncertain about a Cloudflare feature:

**STOP AND VERIFY.**

Do not:

- invent a Wrangler field
- invent a binding
- invent an API method
- invent a pricing limit
- invent a product capability
- assume an old Pages workflow still applies
- assume a Workers API behaves like Node.js
- assume a Cloudflare service provides a database guarantee it does not provide
- assume a feature is available on the current plan

Prefer:

```text
Current Cloudflare docs
        +
Installed Cloudflare skill
        +
Actual project configuration
        +
Installed package/runtime versions
```

over model memory.

## Cloudflare Skill Selection Principle

Do not load every Cloudflare skill for every task.

Use the smallest relevant set of Cloudflare skills needed for the current implementation while preserving required quality and verification gates.

Examples:

```text
Static Astro page
    ↓
Cloudflare hosting guidance
    +
web-perf if performance is relevant
```

```text
R2 upload feature
    ↓
Cloudflare platform guidance
    +
Wrangler
    +
R2-specific guidance
    +
security/anti-abuse if publicly exposed
```

```text
Bot protection
    ↓
Turnstile
    +
Cloudflare security
    +
anti-abuse.md
```

```text
Durable real-time state
    ↓
Durable Objects
    +
Workers
    +
relevant security/performance guidance
```

Do not create unnecessary context or duplicate guidance from unrelated skills.

## Cloudflare Source of Truth

For Cloudflare-specific implementation details, the priority order is:

1. Current official Cloudflare documentation
2. Installed official Cloudflare Agent Skills
3. Actual project configuration and installed package/runtime versions
4. Project architecture/ADRs
5. General model knowledge

When these disagree, investigate the discrepancy rather than silently choosing one.

The architecture and project decisions still govern intentional project-specific choices, but Cloudflare API/runtime facts must be verified against current Cloudflare sources.

---

# 41. MODEL ROUTING — NIM OFFLOAD

The main loop always runs on the executor model (`deepseek-v4-flash`, paid).
For the task types below, dispatch the named subagent profile
(`task(profile="<name>", ...)`) instead of doing the work inline: the profile
runs on a free NVIDIA NIM preview model ($0/token) and returns text to the
main loop. The user never specifies the model — `agent.subagent_models` pins
it. This is the canonical routing table; keep it in sync with
`docs/reasonix/plans/model-routing.md`.

## Routed to free NIM

| Task type                                    | Subagent profile    | NIM model                                  |
| -------------------------------------------- | ------------------- | ------------------------------------------ |
| Code review (diff critique)                  | `review` (builtin)  | `z-ai/glm-5.2`                             |
| Codebase exploration / search                | `explore` (builtin) | `meta/llama-3.1-8b-instruct`               |
| Commit-message drafting                      | `commit`            | `meta/llama-3.1-8b-instruct`               |
| Summarize / compress                         | `summarize`         | `nvidia/nvidia-nemotron-nano-9b-v2`        |
| Triage / classify failures, alerts           | `triage`            | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |
| Hard multi-step reasoning                    | `reasoner`          | `nvidia/nemotron-3-ultra-550b-a55b`        |
| Image / screenshot understanding             | `vision`            | `meta/llama-3.2-11b-vision-instruct`       |
| Web-quality audits (a11y/SEO/best-practices) | `web-quality`       | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |
| Marketing copy / landing copy                | `marketing-copy`    | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |
| SEO content writing                          | `seo-writer`        | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |
| Page/template generation                     | `page-templates`    | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |

## Stays on the main loop (flash)

Code writing, debugging/root-cause, architecture & API design, planning and
specification, test writing, refactoring, performance work, browser/E2E
verification, migrations, documentation, observability, CI/CD and shipping.
Do not offload these to NIM — tool-loop reliability and correctness stakes
are too high.

## Security review stays on pro

`security-review` (builtin) is pinned to `deepseek-v4-pro` — the only
allowed pro usage. Never route security review to NIM.

## Fallback rules

- NIM free tier is ~40 RPM shared per API key (not per model). If a NIM
  subagent hits HTTP 429 or repeated 5xx (e.g. 504 on cold start), retry
  once with backoff, then fall back to doing the task on the main loop
  (flash). Never fall back to pro.
- NIM cold starts can take 1–4 minutes (e.g. `seo-writer`, `reasoner`).
  Prefer starting mapped work early; do not interpret a slow first response
  as failure.

# 42. MODEL ATTRIBUTION

Always state which model generated the output you deliver — a subagent profile
and its model, or the main-loop executor. Prefer placing this at the **end** of
the reply, e.g.:

> _Generated by `reasoner` (`nvidia/nemotron-3-ultra-550b-a55b`) via NIM._

Applies to every kind of generated output: code, text, analysis, summaries,
commit messages, audits, marketing copy, and so on. When a subagent produced
the work, name the profile and its pinned model; when the main loop did, name
the executor model (default `deepseek-v4-flash`).
