import path from "node:path";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

type ConvergenceApiResponse = {
  apiPaused: boolean | null;
  chainPaused: boolean;
  lastTxHash: string | null;
  lastEventName: string | null;
  lastBlock: string | null;
};

const e2eToken = requireEnv("NEXT_PUBLIC_E2E_INTERNAL_TOKEN");
const databaseUrl = requireEnv("DATABASE_URL");
requireEnv("E2E_ADMIN_PRIVATE_KEY");
const metadata = require("../config/deployment-metadata.json") as {
  chainId: number;
  contracts: { EscrowFlowRegistry: string };
};

test("frontend -> tx -> sync -> db/api/ui convergence", async ({ page, request }) => {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
  const expectedContractAddress = metadata.contracts.EscrowFlowRegistry.toLowerCase();

  try {
    await page.goto("/e2e/production-convergence");
    await page.getByRole("button", { name: "Run pause convergence flow" }).click();

    const txHashText = await page.getByTestId("e2e-tx-hash").innerText();
    expect(txHashText, "UI did not render tx hash from contract write").toMatch(/^txHash: 0x[a-fA-F0-9]{64}$/);

    const uiChainPaused = await page.getByTestId("e2e-chain-paused").innerText();
    const uiApiPaused = await page.getByTestId("e2e-api-paused").innerText();
    const txHash = txHashText.replace("txHash: ", "").toLowerCase();

    const apiRes = await request.get("/api/internal/e2e/pause-convergence", {
      headers: {
        "x-e2e-token": e2eToken,
      },
    });
    expect(apiRes.ok(), "API state endpoint failed").toBeTruthy();
    const apiJson = (await apiRes.json()) as ConvergenceApiResponse;
    expect(apiJson.lastTxHash?.toLowerCase(), "API last tx does not match UI tx").toBe(txHash);
    expect(String(apiJson.chainPaused), "API chainPaused diverges from UI").toBe(
      uiChainPaused.replace("chainPaused: ", ""),
    );
    expect(String(apiJson.apiPaused), "API projected paused diverges from UI").toBe(
      uiApiPaused.replace("apiPaused: ", ""),
    );

    const row = await prisma.contractPauseState.findUnique({
      where: {
        chainId_contractAddress: {
          chainId: metadata.chainId,
          contractAddress: expectedContractAddress,
        },
      },
      select: {
        paused: true,
        lastChangedTxHash: true,
      },
    });
    expect(row, "DB projection row missing in contract_pause_states").not.toBeNull();
    expect(row?.lastChangedTxHash.toLowerCase(), "DB tx hash diverges from UI/API").toBe(txHash);
    expect(String(row?.paused), "DB paused value diverges from UI/API").toBe(
      uiApiPaused.replace("apiPaused: ", ""),
    );
  } finally {
    await prisma.$disconnect();
  }
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for e2e test execution`);
  }
  return value;
}

process.env.PW_TEST_SOURCE = path.basename(__filename);
