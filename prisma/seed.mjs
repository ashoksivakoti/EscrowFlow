import {
  DisputeStatus,
  MilestoneStatus,
  NotificationType,
  PlatformRole,
  PrismaClient,
  ProjectStatus,
  SubmissionStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_CHAIN_ID = 84532;

const participants = [
  {
    key: "ava",
    walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    displayName: "Ava Patel",
    email: "ava@northbridge.studio",
    bio: "Product lead focused on fintech and trust workflows.",
    roles: [PlatformRole.CLIENT],
  },
  {
    key: "marcus",
    walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    displayName: "Marcus Chen",
    email: "marcus@altitudecommerce.io",
    bio: "Founder running marketplace and checkout modernization projects.",
    roles: [PlatformRole.CLIENT],
  },
  {
    key: "olivia",
    walletAddress: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    displayName: "Olivia Reed",
    email: "olivia@horizonlabs.co",
    bio: "Operations owner for analytics and automation initiatives.",
    roles: [PlatformRole.CLIENT],
  },
  {
    key: "nina",
    walletAddress: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    displayName: "Nina Brooks",
    email: "nina@escrowflow.dev",
    bio: "Platform admin and enterprise client pilot sponsor.",
    roles: [PlatformRole.ADMIN, PlatformRole.CLIENT],
  },
  {
    key: "daniel",
    walletAddress: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
    displayName: "Daniel Kim",
    email: "daniel@orbitworks.dev",
    bio: "Full-stack engineer specialized in payments and audits.",
    roles: [PlatformRole.FREELANCER],
  },
  {
    key: "sofia",
    walletAddress: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
    displayName: "Sofia Alvarez",
    email: "sofia@craftlogic.io",
    bio: "Freelance architect for dashboards and data-intensive products.",
    roles: [PlatformRole.FREELANCER],
  },
  {
    key: "priya",
    walletAddress: "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    displayName: "Priya Nair",
    email: "priya@stackmint.co",
    bio: "Backend and DevOps consultant for high reliability systems.",
    roles: [PlatformRole.FREELANCER],
  },
  {
    key: "liam",
    walletAddress: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
    displayName: "Liam OBrien",
    email: "liam@ledgerforge.dev",
    bio: "Smart-contract aware integrator with escrow payout experience.",
    roles: [PlatformRole.FREELANCER],
  },
];

const projectSpecs = [
  {
    title: "Mobile banking app revamp",
    status: ProjectStatus.ACTIVE,
    client: "ava",
    freelancer: "daniel",
    totalValueWei: "185000000",
    updatedDaysAgo: 1,
    milestones: [
      {
        title: "UX audit and architecture",
        amountWei: "40000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -20,
      },
      {
        title: "Design system v2",
        amountWei: "55000000",
        status: MilestoneStatus.CLIENT_REVIEW,
        dueInDays: 2,
        submission: {
          status: SubmissionStatus.SUBMITTED,
          summary: "Component inventory, Figma token map, and migration guide.",
          submittedDaysAgo: 1,
        },
      },
      {
        title: "Implementation sprint",
        amountWei: "90000000",
        status: MilestoneStatus.IN_PROGRESS,
        dueInDays: 10,
      },
    ],
  },
  {
    title: "Marketplace checkout rebuild",
    status: ProjectStatus.AWAITING_ESCROW,
    client: "marcus",
    freelancer: "sofia",
    totalValueWei: "120000000",
    updatedDaysAgo: 0,
    milestones: [
      {
        title: "Checkout flow redesign",
        amountWei: "50000000",
        status: MilestoneStatus.AWAITING_FUNDS,
        dueInDays: 7,
      },
      {
        title: "Risk and fraud hardening",
        amountWei: "70000000",
        status: MilestoneStatus.PLANNED,
        dueInDays: 21,
      },
    ],
  },
  {
    title: "Creator analytics dashboard",
    status: ProjectStatus.AWAITING_FREELANCER,
    client: "olivia",
    freelancer: null,
    totalValueWei: "95000000",
    updatedDaysAgo: 3,
    milestones: [
      {
        title: "Event taxonomy and schema",
        amountWei: "30000000",
        status: MilestoneStatus.PLANNED,
        dueInDays: 9,
      },
      {
        title: "Dashboard UI implementation",
        amountWei: "65000000",
        status: MilestoneStatus.PLANNED,
        dueInDays: 24,
      },
    ],
  },
  {
    title: "AI support copilot integration",
    status: ProjectStatus.ON_HOLD,
    client: "nina",
    freelancer: "priya",
    totalValueWei: "210000000",
    updatedDaysAgo: 5,
    milestones: [
      {
        title: "Knowledge base ingestion",
        amountWei: "70000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -18,
      },
      {
        title: "Internal assistant sandbox",
        amountWei: "70000000",
        status: MilestoneStatus.REJECTED,
        dueInDays: -1,
        submission: {
          status: SubmissionStatus.REJECTED,
          summary: "Prompt orchestration and retrieval benchmarks submitted for review.",
          submittedDaysAgo: 4,
        },
      },
      {
        title: "Production rollout controls",
        amountWei: "70000000",
        status: MilestoneStatus.FUNDED,
        dueInDays: 12,
      },
    ],
  },
  {
    title: "Compliance reporting pipeline",
    status: ProjectStatus.COMPLETED,
    client: "ava",
    freelancer: "liam",
    totalValueWei: "145000000",
    updatedDaysAgo: 7,
    milestones: [
      {
        title: "Data extraction adapters",
        amountWei: "45000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -30,
      },
      {
        title: "Regulatory report generator",
        amountWei: "50000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -24,
      },
      {
        title: "Auditor signoff automation",
        amountWei: "50000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -16,
      },
    ],
  },
  {
    title: "Payment reconciliation microservice",
    status: ProjectStatus.ACTIVE,
    client: "marcus",
    freelancer: "daniel",
    totalValueWei: "132000000",
    updatedDaysAgo: 1,
    milestones: [
      {
        title: "Ledger sync core",
        amountWei: "42000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -14,
      },
      {
        title: "Exception queue and retry jobs",
        amountWei: "45000000",
        status: MilestoneStatus.SUBMITTED,
        dueInDays: 1,
        submission: {
          status: SubmissionStatus.SUBMITTED,
          summary: "Retry queue behavior and replay simulation package.",
          submittedDaysAgo: 1,
        },
      },
      {
        title: "Ops dashboards and alerts",
        amountWei: "45000000",
        status: MilestoneStatus.FUNDED,
        dueInDays: 8,
      },
    ],
  },
  {
    title: "Multi-chain settlement portal",
    status: ProjectStatus.DISPUTED,
    client: "olivia",
    freelancer: "sofia",
    totalValueWei: "160000000",
    updatedDaysAgo: 2,
    milestones: [
      {
        title: "Bridge abstraction layer",
        amountWei: "80000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -12,
      },
      {
        title: "Settlement queue and failover",
        amountWei: "80000000",
        status: MilestoneStatus.DISPUTED,
        dueInDays: -3,
        submission: {
          status: SubmissionStatus.UNDER_REVIEW,
          summary: "Cross-chain settlement failover benchmark report.",
          submittedDaysAgo: 3,
        },
        dispute: {
          status: DisputeStatus.OPEN,
          title: "Settlement mismatch in edge cases",
          description:
            "Client observed inconsistent settlement totals during synthetic load tests.",
          openedBy: "olivia",
          daysAgo: 2,
        },
      },
    ],
  },
  {
    title: "Escrow analytics observability pack",
    status: ProjectStatus.ACTIVE,
    client: "ava",
    freelancer: "priya",
    totalValueWei: "98000000",
    updatedDaysAgo: 0,
    milestones: [
      {
        title: "Metric taxonomy and traces",
        amountWei: "32000000",
        status: MilestoneStatus.RELEASED,
        dueInDays: -9,
      },
      {
        title: "Alerting and anomaly policy",
        amountWei: "33000000",
        status: MilestoneStatus.IN_PROGRESS,
        dueInDays: 4,
      },
      {
        title: "Executive summary dashboard",
        amountWei: "33000000",
        status: MilestoneStatus.FUNDED,
        dueInDays: 11,
      },
    ],
  },
];

function daysOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function newIpfsUri(label) {
  const suffix = Buffer.from(label).toString("hex").slice(0, 46).padEnd(46, "0");
  return `ipfs://bafy${suffix}`;
}

async function cleanupExistingSeedData(wallets) {
  const seedUsers = await prisma.user.findMany({
    where: { walletAddress: { in: wallets } },
    select: { id: true },
  });
  const userIds = seedUsers.map((user) => user.id);
  if (userIds.length === 0) {
    return;
  }

  await prisma.transactionLog.deleteMany({
    where: {
      OR: [
        { initiatedByUserId: { in: userIds } },
        {
          project: {
            OR: [{ clientUserId: { in: userIds } }, { freelancerUserId: { in: userIds } }],
          },
        },
      ],
    },
  });

  await prisma.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        {
          project: {
            OR: [{ clientUserId: { in: userIds } }, { freelancerUserId: { in: userIds } }],
          },
        },
      ],
    },
  });

  await prisma.review.deleteMany({
    where: {
      OR: [
        { authorUserId: { in: userIds } },
        { subjectUserId: { in: userIds } },
        {
          project: {
            OR: [{ clientUserId: { in: userIds } }, { freelancerUserId: { in: userIds } }],
          },
        },
      ],
    },
  });

  await prisma.project.deleteMany({
    where: {
      OR: [{ clientUserId: { in: userIds } }, { freelancerUserId: { in: userIds } }],
    },
  });

  await prisma.userPlatformRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.profile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function upsertParticipants() {
  const usersByKey = {};
  for (const participant of participants) {
    const user = await prisma.user.upsert({
      where: { walletAddress: participant.walletAddress },
      update: {
        lastLoginAt: daysOffset(-1),
        profile: {
          upsert: {
            update: {
              displayName: participant.displayName,
              email: participant.email,
              bio: participant.bio,
            },
            create: {
              displayName: participant.displayName,
              email: participant.email,
              bio: participant.bio,
            },
          },
        },
      },
      create: {
        walletAddress: participant.walletAddress,
        lastLoginAt: daysOffset(-1),
        profile: {
          create: {
            displayName: participant.displayName,
            email: participant.email,
            bio: participant.bio,
          },
        },
      },
    });

    await prisma.userPlatformRole.createMany({
      data: participant.roles.map((role) => ({
        userId: user.id,
        role,
      })),
    });

    usersByKey[participant.key] = user;
  }
  return usersByKey;
}

async function seedProjects(usersByKey) {
  let txCounter = 1;
  let disputeCount = 0;
  let projectCount = 0;

  const nextTxMeta = () => {
    const txHash = `0x${txCounter.toString(16).padStart(64, "0")}`;
    const blockNumber = BigInt(4_800_000 + txCounter);
    txCounter += 1;
    return { txHash, blockNumber };
  };

  for (const spec of projectSpecs) {
    const client = usersByKey[spec.client];
    const freelancer = spec.freelancer ? usersByKey[spec.freelancer] : null;

    const project = await prisma.project.create({
      data: {
        clientUserId: client.id,
        freelancerUserId: freelancer?.id ?? null,
        status: spec.status,
        title: spec.title,
        description: `${spec.title} delivery tracked through milestone escrow.`,
        agreementIpfsUri: newIpfsUri(`${spec.title}-agreement`),
        chainId: DEFAULT_CHAIN_ID,
        escrowContractAddress: `0x${String(projectCount + 1).padStart(40, "1")}`,
        onChainProjectId: String(10_000 + projectCount),
        paymentTokenAddress: "0x4200000000000000000000000000000000000006",
        totalValueWei: spec.totalValueWei,
        updatedAt: daysOffset(-spec.updatedDaysAgo),
      },
    });
    projectCount += 1;

    const milestones = [];
    for (let idx = 0; idx < spec.milestones.length; idx += 1) {
      const milestoneSpec = spec.milestones[idx];
      const milestone = await prisma.milestone.create({
        data: {
          projectId: project.id,
          sortOrder: idx + 1,
          title: milestoneSpec.title,
          description: `${milestoneSpec.title} scope and acceptance criteria.`,
          amountWei: milestoneSpec.amountWei,
          status: milestoneSpec.status,
          dueAt: daysOffset(milestoneSpec.dueInDays),
          specificationIpfsUri: newIpfsUri(`${spec.title}-${milestoneSpec.title}`),
          fundedAt:
            milestoneSpec.status === MilestoneStatus.AWAITING_FUNDS ||
            milestoneSpec.status === MilestoneStatus.PLANNED
              ? null
              : daysOffset(milestoneSpec.dueInDays - 6),
          releasedAt: milestoneSpec.status === MilestoneStatus.RELEASED ? daysOffset(-2) : null,
          updatedAt: daysOffset(-Math.max(0, spec.updatedDaysAgo - idx)),
        },
      });
      milestones.push(milestone);

      if (milestoneSpec.submission && freelancer) {
        await prisma.submission.create({
          data: {
            milestoneId: milestone.id,
            submittedByUserId: freelancer.id,
            status: milestoneSpec.submission.status,
            deliverablesIpfsUri: newIpfsUri(`${project.title}-submission-${idx + 1}`),
            summary: milestoneSpec.submission.summary,
            attemptNumber: 1,
            submittedAt: daysOffset(-milestoneSpec.submission.submittedDaysAgo),
            decidedAt:
              milestoneSpec.submission.status === SubmissionStatus.REJECTED
                ? daysOffset(-1)
                : null,
          },
        });
      }

      if (milestoneSpec.dispute && freelancer) {
        const openedBy = usersByKey[milestoneSpec.dispute.openedBy];
        await prisma.dispute.create({
          data: {
            milestoneId: milestone.id,
            openedByUserId: openedBy.id,
            status: milestoneSpec.dispute.status,
            title: milestoneSpec.dispute.title,
            description: milestoneSpec.dispute.description,
            evidenceIpfsUri: newIpfsUri(`${project.title}-dispute-${idx + 1}`),
            internalNotes:
              "Initial triage completed. Waiting for additional evidence from both parties.",
            createdAt: daysOffset(-milestoneSpec.dispute.daysAgo),
            updatedAt: daysOffset(-milestoneSpec.dispute.daysAgo),
          },
        });
        disputeCount += 1;
      }
    }

    const firstMilestone = milestones[0];
    const secondMilestone = milestones[1] ?? null;

    const fundedTx = nextTxMeta();
    await prisma.transactionLog.create({
      data: {
        chainId: DEFAULT_CHAIN_ID,
        blockNumber: fundedTx.blockNumber,
        txHash: fundedTx.txHash,
        logIndex: 0,
        eventName: "EscrowFunded",
        projectId: project.id,
        milestoneId: firstMilestone.id,
        initiatedByUserId: client.id,
        fromAddress: client.walletAddress,
        toAddress: project.escrowContractAddress,
        payload: {
          amount: spec.totalValueWei,
          blockTimestamp: daysOffset(-spec.updatedDaysAgo).toISOString(),
        },
      },
    });

    if (milestones.some((m) => m.status === MilestoneStatus.RELEASED) && freelancer) {
      const releaseTx = nextTxMeta();
      await prisma.transactionLog.create({
        data: {
          chainId: DEFAULT_CHAIN_ID,
          blockNumber: releaseTx.blockNumber,
          txHash: releaseTx.txHash,
          logIndex: 0,
          eventName: "MilestoneFundsReleased",
          projectId: project.id,
          milestoneId: firstMilestone.id,
          initiatedByUserId: client.id,
          fromAddress: project.escrowContractAddress,
          toAddress: freelancer.walletAddress,
          payload: {
            amount: firstMilestone.amountWei,
            blockTimestamp: daysOffset(-Math.max(1, spec.updatedDaysAgo)).toISOString(),
          },
        },
      });
    }

    if (spec.status === ProjectStatus.DISPUTED && secondMilestone) {
      const disputeTx = nextTxMeta();
      await prisma.transactionLog.create({
        data: {
          chainId: DEFAULT_CHAIN_ID,
          blockNumber: disputeTx.blockNumber,
          txHash: disputeTx.txHash,
          logIndex: 0,
          eventName: "DisputeOpened",
          projectId: project.id,
          milestoneId: secondMilestone.id,
          initiatedByUserId: client.id,
          fromAddress: client.walletAddress,
          toAddress: project.escrowContractAddress,
          payload: {
            blockTimestamp: daysOffset(-2).toISOString(),
          },
        },
      });
    }

    if (spec.status === ProjectStatus.COMPLETED && freelancer) {
      const settleTx = nextTxMeta();
      await prisma.transactionLog.create({
        data: {
          chainId: DEFAULT_CHAIN_ID,
          blockNumber: settleTx.blockNumber,
          txHash: settleTx.txHash,
          logIndex: 0,
          eventName: "DisputeResolved",
          projectId: project.id,
          milestoneId: secondMilestone?.id ?? firstMilestone.id,
          initiatedByUserId: usersByKey.nina.id,
          fromAddress: project.escrowContractAddress,
          toAddress: freelancer.walletAddress,
          payload: {
            freelancerAmount: secondMilestone?.amountWei ?? firstMilestone.amountWei,
            clientAmount: "0",
            blockTimestamp: daysOffset(-6).toISOString(),
          },
        },
      });

      await prisma.review.create({
        data: {
          projectId: project.id,
          authorUserId: client.id,
          subjectUserId: freelancer.id,
          rating: 5,
          headline: "Reliable delivery",
          body: "Milestones landed on time with clear documentation and clean handoff.",
        },
      });
    }

    await prisma.notification.create({
      data: {
        userId: client.id,
        type: NotificationType.PROJECT,
        title: `${project.title} status: ${project.status}`,
        body:
          project.status === ProjectStatus.AWAITING_ESCROW
            ? "Escrow funding is required before freelancer execution can begin."
            : "Latest project updates are available on your dashboard.",
        projectId: project.id,
        createdAt: daysOffset(-spec.updatedDaysAgo),
      },
    });

    if (freelancer) {
      await prisma.notification.create({
        data: {
          userId: freelancer.id,
          type: NotificationType.MILESTONE,
          title: `${project.title} has new milestone activity`,
          body: "Review your assigned milestones and submit deliverables where required.",
          projectId: project.id,
          milestoneId: secondMilestone?.id ?? firstMilestone.id,
          createdAt: daysOffset(-Math.max(0, spec.updatedDaysAgo - 1)),
        },
      });
    }
  }

  return { projectCount, disputeCount };
}

async function main() {
  const seededWallets = participants.map((participant) => participant.walletAddress);
  await cleanupExistingSeedData(seededWallets);
  const usersByKey = await upsertParticipants();
  const { projectCount, disputeCount } = await seedProjects(usersByKey);

  console.log("Seed complete.");
  console.log(`Users: ${Object.keys(usersByKey).length}`);
  console.log(`Projects: ${projectCount}`);
  console.log(`Open disputes: ${disputeCount}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
