import { run } from "hardhat";

async function main() {
  const address = process.env.CANONICAL_ESCROW_REGISTRY_ADDRESS?.trim() ?? "";
  const admin = process.env.CANONICAL_REGISTRY_ADMIN_ADDRESS?.trim() ?? "";

  if (!address) {
    throw new Error("CANONICAL_ESCROW_REGISTRY_ADDRESS is required");
  }
  if (!admin) {
    throw new Error("CANONICAL_REGISTRY_ADMIN_ADDRESS is required");
  }

  await run("verify:verify", {
    address,
    constructorArguments: [admin],
  });

  console.log(
    JSON.stringify(
      {
        verifiedAddress: address,
        constructorArguments: [admin],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
