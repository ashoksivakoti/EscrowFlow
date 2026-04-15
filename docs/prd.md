# Product requirements (PRD) — EscrowFlow

**Status:** draft — foundation phase  
**Audience:** product, engineering, design

## Problem

Freelance work often suffers from **payment timing and trust** issues: clients fear paying upfront; freelancers fear non-payment after delivery. Milestone-based escrow reduces both risks when it is **transparent, enforceable, and usable**.

## Product vision

EscrowFlow is a **milestone-based escrow** platform where:

- **Clients** define projects and milestones, fund escrow with **ERC20 stablecoins**, and approve or dispute deliverables.
- **Freelancers** submit milestone work, attach evidence, and receive payouts on approval.
- **Admins / arbitrators** resolve disputes with an auditable trail.
- The system integrates **on-chain state** (funds, releases) with **off-chain orchestration** (notifications, rich metadata, file storage).

## Goals (MVP direction)

1. **Create and fund** a project with one or more milestones (on-chain deposit + off-chain metadata).
2. **Submit** milestone deliverables with **IPFS-backed** attachments.
3. **Approve / reject** milestones; **automatic payout** on approval per contract rules.
4. **Dispute** flow with evidence upload and **admin resolution**.
5. **Dashboards** for clients and freelancers; **transaction history** and **event sync** from chain.

## Non-goals (initially)

- Multi-token complexity beyond a **single configured stablecoin** per deployment.
- Fully decentralized arbitration (start with **platform-appointed** arbitrators).
- Mobile native apps (web must be **fully responsive**).

## Success metrics (to refine)

- Time to first funded project.
- Milestone approval rate vs dispute rate.
- Failed transaction / support ticket rate.

## Open questions

- Which **EVM network(s)** and **stablecoin** for first production deployment?
- **KYC** or jurisdictional constraints?
- **Fee model** (platform fee on release, subscription, or hybrid)?

Update this document as scope stabilizes.
