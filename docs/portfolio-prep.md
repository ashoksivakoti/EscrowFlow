# EscrowFlow portfolio prep

## Resume bullets

- Built **EscrowFlow**, a production-style milestone escrow platform using Next.js, Prisma/PostgreSQL, Solidity, and wagmi/viem, spanning full-stack product and smart-contract workflows.
- Implemented wallet-native SIWE authentication with secure session cookies, role-aware onboarding, and route-level authorization for client/freelancer/admin experiences.
- Designed and shipped a multi-project escrow contract (`EscrowFlowRegistry`) covering project funding, milestone submission/approval/release, dispute handling, and arbitrator resolution.
- Integrated IPFS for agreement, submission, and dispute evidence metadata with strict MIME/size validation, gateway-safe URI handling, and server-only secret management.
- Built an idempotent blockchain event-sync service with checkpointing and transaction-log persistence to reconcile on-chain events into relational read models.
- Developed responsive SaaS-style dashboards and project workflows (create, fund, submit, review, dispute, notify) with loading/empty/error states and mobile-first usability.
- Added reliability coverage across contracts, backend route handlers/services, and frontend interaction tests; enforced deployment checks via env validation and migration workflows.
- Authored deployment/runbook documentation for contracts, web app, event sync scheduling, and production hardening in a portfolio-friendly architecture.

## Interview talking points

- **Architecture split:** Why financial truth belongs on-chain, while collaboration/read models stay in PostgreSQL.
- **Trust model:** How SIWE auth + escrow lifecycle + IPFS evidence reduce ambiguity in freelance payments.
- **Reliability:** Event-sync idempotency, checkpointing, and failure-retry strategy for RPC/IPFS uncertainty.
- **Security posture:** Session cookie flags, env validation, role guards, input constraints, and contract access control.
- **Product trade-offs:** Portfolio-friendly infra choices (scheduler-triggered sync) versus heavier queue/worker systems.
- **DX and maintainability:** Shared types, thin handlers + service layer, and docs that support onboarding and deployment.

## Demo flow (10-12 minutes)

1. **Landing + login:** show wallet connect + SIWE sign-in (no gas).
2. **Onboarding:** complete role profile and explain role-aware routing.
3. **Client flow:** create a project with milestones and optional agreement upload.
4. **Funding flow:** approve token allowance and fund escrow; show tx lifecycle UI.
5. **Freelancer flow:** submit milestone work with note, link, and files to IPFS.
6. **Client review:** approve + release payout; show status/released amount updates.
7. **Dispute path:** raise dispute with evidence and show frozen milestone behavior.
8. **Admin path:** resolve dispute (refund/payout/split) and explain validation.
9. **Notifications + history:** show unread/read notifications and transaction explorer links.
10. **Operational close:** briefly show docs/deployment readiness and test coverage highlights.
