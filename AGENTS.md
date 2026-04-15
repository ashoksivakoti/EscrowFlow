# EscrowFlow — agent and contributor context

## Product

EscrowFlow is a **milestone-based freelance escrow** platform. Clients create projects, define milestones, and deposit **ERC20 stablecoin** funds into a smart contract. Freelancers submit milestone deliverables. Clients approve them and milestone funds are released securely. The platform also supports **disputes**, **admin/arbitrator resolution**, **notifications**, **dashboards**, **transaction history**, **IPFS-based file storage** (agreements, deliverables, dispute evidence), and **blockchain event syncing**.

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, fully mobile responsive
- **Backend / data:** Prisma, PostgreSQL
- **Web3:** wagmi, viem, SIWE-style wallet authentication
- **Contracts:** Solidity, Hardhat, OpenZeppelin
- **Storage:** IPFS for agreement metadata, milestone deliverables, and dispute evidence
- **Deployment:** EVM chain

## Engineering expectations

- Clean, modular code and a **production-quality** folder structure
- Strong typing, validation, and robust error handling
- UI: loading, empty, success, and error states; responsive on mobile, tablet, and desktop
- **Testing** across smart contracts, backend, and frontend
- Maintainable code; documentation where it genuinely helps

## How to evolve the codebase

**Each day’s work builds on the previous day.** Do not rewrite the whole project from scratch. **Continue from the current codebase** and improve incrementally while **preserving existing functionality**.

## Cursor rules

Project-specific constraints for the AI are also summarized in `.cursor/rules/` (always-on rule). This file is the **single narrative source of truth** for product and stack; update here when direction changes.
