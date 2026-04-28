export const durinRegistrarAbi = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "available",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getName",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFullName",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setPrimaryName",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "NameRegistered",
    inputs: [
      { name: "label", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: false },
    ],
  },
] as const;
