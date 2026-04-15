export const escrowRegistryAbi = [
  {
    type: "function",
    name: "fundProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getProject",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "freelancer", type: "address" },
          { name: "token", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "fundedAmount", type: "uint256" },
          { name: "releasedAmount", type: "uint256" },
          { name: "refundedAmount", type: "uint256" },
          { name: "metadataURI", type: "string" },
          { name: "status", type: "uint8" },
          { name: "milestoneCount", type: "uint256" },
        ],
      },
    ],
  },
] as const;
