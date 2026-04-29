export const durinRegistrarAbi = [
  {
    type: "function",
    name: "registerUser",
    inputs: [
      { name: "label", type: "string" },
      { name: "matchPreference", type: "string" },
      { name: "agentBootstrapWallet", type: "address" },
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
    name: "availableAgent",
    inputs: [{ name: "userLabel", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerAgent",
    inputs: [
      { name: "userLabel", type: "string" },
      { name: "agentSmartWallet", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getUserName",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentName",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setUserMatchPreference",
    inputs: [
      { name: "label", type: "string" },
      { name: "matchPreference", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAgentBootstrapWallet",
    inputs: [
      { name: "label", type: "string" },
      { name: "agentSmartWallet", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAgentPublicPointers",
    inputs: [
      { name: "userLabel", type: "string" },
      { name: "lastMatchPointer", type: "string" },
      { name: "statsPointer", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "UserRegistered",
    inputs: [
      { name: "label", type: "string", indexed: true },
      { name: "userNode", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;
