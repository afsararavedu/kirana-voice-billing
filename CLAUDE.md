# CLAUDE.md --- Kirana Voice Billing

## Project objective

Build a production-oriented, multilingual voice billing and inventory
web application for Indian kirana stores. Support Telugu, Hindi, Urdu
and English interface localization, speech input, reliable billing and
stock management.

## Fixed technology decisions

-   Frontend: React, TypeScript, Vite.
-   Backend: Node.js, TypeScript, Express.
-   Database: PostgreSQL.
-   ORM and migrations: Prisma.
-   Validation: Zod or an equivalent shared validation library.
-   API: versioned REST API under `/api/v1`.
-   Localization: i18next or an equivalent mature framework.
-   Testing: Vitest, API integration tests and Playwright.
-   Deployment target: Hostinger VPS with SSH access.
-   Production architecture: Docker Compose, reverse proxy, HTTPS and
    persistent PostgreSQL storage, subject to VPS compatibility checks.
-   Speech and LLM services: provider interfaces with explicit
    environment configuration.

Do not silently replace these choices.

## Required working principles

1.  Inspect the repository before making changes.
2.  Implement one phase at a time.
3.  Do not generate the entire application as a single unverified code
    dump.
4.  Run the relevant lint, type-check, test and build commands after
    each phase.
5.  Fix failures caused by the implementation before marking a phase
    complete.
6.  Never claim a test or deployment succeeded unless its result was
    actually observed.
7.  Never commit secrets, API keys, production data or private
    recordings.
8.  Keep `.env` files out of Git. Maintain `.env.example` with
    placeholders only.
9.  Never execute production migrations or destructive commands without
    an explicit deployment step and a verified backup.
10. Explain assumptions, material design decisions, incomplete work and
    risks.

## Financial correctness

-   Use PostgreSQL `NUMERIC`/`DECIMAL` for monetary values and explicit
    rounding rules.
-   Never use JavaScript floating-point arithmetic as the authoritative
    financial calculation.
-   Calculate prices, discounts, taxes and totals on the server.
-   Retrieve prices from the authenticated store's database.
-   The LLM must never determine authoritative prices, stock balances or
    invoice totals.
-   Finalize a sale, payment records, sale items and inventory movements
    in one consistent database transaction.
-   Prevent duplicate sale confirmations with idempotency.
-   Preserve finalized sale history. Use explicit return, cancellation
    and adjustment records instead of silently rewriting financial
    history.

## Tenant security

-   Every store-owned record must be scoped to the authenticated tenant.
-   Derive tenant permissions from authenticated server-side membership,
    never from an untrusted request field alone.
-   Validate ownership and authorization on every read and write.
-   Add automated tests for cross-tenant access attempts.
-   Use least-privilege database credentials and secure session
    configuration.

## Voice and language behavior

-   Separate UI language, speech input language and receipt language.
-   Support Telugu, Hindi, Urdu and English localization.
-   Use Urdu right-to-left layout and bidirectional text handling.
-   Validate provider/model/region compatibility before selecting speech
    recognition settings.
-   Treat transcripts and model responses as untrusted input.
-   Use schema-constrained or schema-validated LLM output.
-   Match extracted product names to the current tenant's catalog.
-   Ask for clarification when a product, quantity or unit is ambiguous.
-   Require user confirmation before committing a voice-generated sale.
-   Preserve manual billing as a working fallback.

## Engineering requirements

-   Use modular services, controllers, repositories and validation
    schemas.
-   Keep API keys exclusively on the server.
-   Set timeouts, request-size limits, rate limits and safe error
    handling.
-   Use database transactions for critical operations.
-   Add audit records for important changes.
-   Provide structured logs with sensitive information redacted.
-   Implement health checks, migrations, backups and documented recovery
    procedures.
-   Do not introduce a microservice architecture unless a concrete
    requirement justifies it.

## Required validation after each phase

Run the relevant commands for:

-   Formatting and linting.
-   Type checking.
-   Unit tests.
-   Database migration validation.
-   Integration tests.
-   Production frontend and backend builds.
-   End-to-end tests for completed critical workflows.

Report the actual commands and results.

## Definition of done

A feature is complete only when its implementation, validation,
authorization, tests and documentation are present and relevant checks
pass.

Maintain `docs/implementation-status.md` with completed features, test
evidence, known issues and the next recommended step.

Start by inspecting the repository and confirming the environment. Then
propose a phased plan and implement Phase 1 only.
