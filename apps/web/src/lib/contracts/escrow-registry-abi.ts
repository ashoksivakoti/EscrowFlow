export const escrowRegistryAbi = [
  {
    type: "event",
    name: "ProjectCreated",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "freelancer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "milestoneCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "createProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "freelancer", type: "address" },
      { name: "token", type: "address" },
      { name: "metadataURI", type: "string" },
      {
        name: "milestoneInputs",
        type: "tuple[]",
        components: [
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
        ],
      },
    ],
    outputs: [{ name: "projectId", type: "uint256" }],
  },
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
    name: "submitMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "submissionURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "kind", type: "uint8" },
      { name: "freelancerAmount", type: "uint256" },
      { name: "clientAmount", type: "uint256" },
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
  {
    type: "function",
    name: "getMilestone",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "submissionURI", type: "string" },
        ],
      },
    ],
  },
] as const;
