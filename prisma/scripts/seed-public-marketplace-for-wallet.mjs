/**
 * Insert OPEN + PUBLIC + unassigned marketplace projects for a client wallet so they appear on /discover.
 *
 * Usage (from repo root):
 *   pnpm db:seed:public-marketplace
 *   node prisma/scripts/seed-public-marketplace-for-wallet.mjs 0xYourClientWalletHere
 *
 * Requires DATABASE_URL. Loads `.env` / `.env.local` from repo root when present.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MilestoneStatus,
  PrismaClient,
  ProjectStatus,
  ProjectVisibility,
} from "@prisma/client";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function loadDotEnv() {
  for (const name of [".env", ".env.local"]) {
    try {
      const p = resolve(repoRoot, name);
      const raw = readFileSync(p, "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // optional file
    }
  }
}

loadDotEnv();

const DEFAULT_WALLET = "0x622a2d34f241D19726E27bf55Be3c255b2f7BDB4";

function normalizeWallet(raw) {
  const s = String(raw).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new Error(`Invalid EVM address: ${raw}`);
  }
  return s.toLowerCase();
}

const walletArg = process.argv[2] || process.env.CLIENT_WALLET || DEFAULT_WALLET;
const walletAddress = normalizeWallet(walletArg);

const prisma = new PrismaClient();

const SAMPLE_PROJECTS = [
  {
    title: "Escrow dashboard API hardening",
    description:
      "Harden Next.js route handlers, Prisma transactions, and marketplace listing queries. Experience with Vitest required.",
    milestones: [
      { title: "Audit + test plan", amountWei: "25000000000000000000", sortOrder: 0 },
      { title: "Implementation + PR", amountWei: "75000000000000000000", sortOrder: 1 },
    ],
  },
  {
    title: "Public discover page UX polish",
    description:
      "Responsive cards, empty states, and apply flow for marketplace discovery. Tailwind and shadcn experience preferred.",
    milestones: [{ title: "Design + build", amountWei: "50000000000000000000", sortOrder: 0 }],
  },
  {
    title: "IPFS agreement pipeline reliability",
    description:
      "Improve agreement upload fallbacks and logging for client marketplace posts. Node + IPFS pinning background.",
    milestones: [
      { title: "Spike + recommendations", amountWei: "15000000000000000000", sortOrder: 0 },
      { title: "Production fixes", amountWei: "35000000000000000000", sortOrder: 1 },
    ],
  },
];

function sumWei(milestones) {
  return milestones.reduce((acc, m) => acc + BigInt(m.amountWei), 0n).toString();
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { walletAddress: walletAddress },
    select: { id: true, walletAddress: true },
  });

  if (!user) {
    console.error(
      `No user found for wallet ${walletAddress}. Sign in once with SIWE or add the user to the DB, then re-run.`,
    );
    process.exitCode = 1;
    return;
  }

  const due = new Date();
  due.setDate(due.getDate() + 30);

  for (const spec of SAMPLE_PROJECTS) {
    const totalValueWei = sumWei(spec.milestones);

    const project = await prisma.project.create({
      data: {
        clientUserId: user.id,
        freelancerUserId: null,
        status: ProjectStatus.OPEN,
        visibility: ProjectVisibility.PUBLIC,
        title: spec.title,
        description: spec.description,
        agreementIpfsUri: null,
        chainId: null,
        escrowContractAddress: null,
        onChainProjectId: null,
        paymentTokenAddress: null,
        totalValueWei,
        milestones: {
          create: spec.milestones.map((m) => ({
            sortOrder: m.sortOrder,
            title: m.title,
            description: null,
            amountWei: m.amountWei,
            dueAt: due,
            status: MilestoneStatus.PLANNED,
          })),
        },
      },
    });

    console.log(`Created OPEN/PUBLIC project ${project.id} — ${spec.title}`);
  }

  console.log(`Done. ${SAMPLE_PROJECTS.length} marketplace-visible projects for ${user.walletAddress}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
