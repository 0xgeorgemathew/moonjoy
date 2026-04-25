import { expect, test } from "bun:test";
import {
  getAvailableMatchActions,
  isMatchReady,
  isSettlementGraceActive,
} from "./match.ts";

test("isMatchReady requires both seats, agents, and wallet delegations", () => {
  expect(
    isMatchReady({
      hasCreator: true,
      hasOpponent: true,
      creatorAgentConnected: true,
      opponentAgentConnected: true,
      creatorWalletDelegated: true,
      opponentWalletDelegated: true,
    }),
  ).toBe(true);

  expect(
    isMatchReady({
      hasCreator: true,
      hasOpponent: true,
      creatorAgentConnected: true,
      opponentAgentConnected: false,
      creatorWalletDelegated: true,
      opponentWalletDelegated: true,
    }),
  ).toBe(false);
});

test("getAvailableMatchActions exposes start only after readiness passes", () => {
  const readyMatch = {
    hasCreator: true,
    hasOpponent: true,
    creatorAgentConnected: true,
    opponentAgentConnected: true,
    creatorWalletDelegated: true,
    opponentWalletDelegated: true,
  };

  expect(
    getAvailableMatchActions("accepted", readyMatch),
  ).toEqual(["start_match"]);

  expect(
    getAvailableMatchActions("ready", readyMatch),
  ).toEqual(["start_match"]);

  expect(
    getAvailableMatchActions("accepted", {
      hasCreator: true,
      hasOpponent: true,
      creatorAgentConnected: false,
      opponentAgentConnected: true,
      creatorWalletDelegated: true,
      opponentWalletDelegated: false,
    }),
  ).toEqual(["connect_agent", "delegate_wallet"]);
});

test("isSettlementGraceActive closes after the grace window", () => {
  const endsAt = new Date("2026-04-25T00:00:00.000Z");

  expect(
    isSettlementGraceActive(new Date("2026-04-24T23:59:59.000Z"), {
      startsAt: null,
      endsAt,
      settledAt: null,
    }),
  ).toBe(false);

  expect(
    isSettlementGraceActive(new Date("2026-04-25T00:00:10.000Z"), {
      startsAt: null,
      endsAt,
      settledAt: null,
    }),
  ).toBe(true);

  expect(
    isSettlementGraceActive(new Date("2026-04-25T00:00:16.000Z"), {
      startsAt: null,
      endsAt,
      settledAt: null,
    }),
  ).toBe(false);
});
