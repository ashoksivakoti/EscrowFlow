import { describe, expect, it } from "vitest";
import { MilestoneStatus } from "@prisma/client";

import { milestoneFundingSyncUpdates } from "@/server/services/funding-service";

const now = new Date("2026-04-18T12:00:00.000Z");

describe("milestoneFundingSyncUpdates", () => {
  it("promotes the first milestone when funded covers only the first amount", () => {
    const updates = milestoneFundingSyncUpdates(
      [
        { id: "m1", sortOrder: 0, status: MilestoneStatus.PLANNED, amountWei: "100", fundedAt: null },
        { id: "m2", sortOrder: 1, status: MilestoneStatus.PLANNED, amountWei: "200", fundedAt: null },
      ],
      100n,
      now,
    );
    expect(updates).toEqual([{ id: "m1", status: MilestoneStatus.FUNDED, fundedAt: now }]);
  });

  it("promotes all milestones when fully funded", () => {
    const updates = milestoneFundingSyncUpdates(
      [
        { id: "m1", sortOrder: 0, status: MilestoneStatus.PLANNED, amountWei: "100", fundedAt: null },
        { id: "m2", sortOrder: 1, status: MilestoneStatus.PLANNED, amountWei: "200", fundedAt: null },
      ],
      300n,
      now,
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ id: "m1", status: MilestoneStatus.FUNDED, fundedAt: now });
    expect(updates[1]).toEqual({ id: "m2", status: MilestoneStatus.FUNDED, fundedAt: now });
  });

  it("does not promote milestones beyond cumulative funding", () => {
    const updates = milestoneFundingSyncUpdates(
      [
        { id: "m1", sortOrder: 0, status: MilestoneStatus.PLANNED, amountWei: "100", fundedAt: null },
        { id: "m2", sortOrder: 1, status: MilestoneStatus.PLANNED, amountWei: "200", fundedAt: null },
      ],
      150n,
      now,
    );
    expect(updates).toEqual([{ id: "m1", status: MilestoneStatus.FUNDED, fundedAt: now }]);
  });

  it("ignores non-plannable statuses", () => {
    const updates = milestoneFundingSyncUpdates(
      [
        { id: "m1", sortOrder: 0, status: MilestoneStatus.SUBMITTED, amountWei: "100", fundedAt: null },
        { id: "m2", sortOrder: 1, status: MilestoneStatus.PLANNED, amountWei: "200", fundedAt: null },
      ],
      300n,
      now,
    );
    expect(updates).toEqual([{ id: "m2", status: MilestoneStatus.FUNDED, fundedAt: now }]);
  });

  it("sorts by sortOrder when rows are out of order", () => {
    const updates = milestoneFundingSyncUpdates(
      [
        { id: "m2", sortOrder: 1, status: MilestoneStatus.PLANNED, amountWei: "200", fundedAt: null },
        { id: "m1", sortOrder: 0, status: MilestoneStatus.PLANNED, amountWei: "100", fundedAt: null },
      ],
      100n,
      now,
    );
    expect(updates).toEqual([{ id: "m1", status: MilestoneStatus.FUNDED, fundedAt: now }]);
  });

  it("promotes AWAITING_FUNDS", () => {
    const updates = milestoneFundingSyncUpdates(
      [{ id: "m1", sortOrder: 0, status: MilestoneStatus.AWAITING_FUNDS, amountWei: "50", fundedAt: null }],
      50n,
      now,
    );
    expect(updates).toEqual([{ id: "m1", status: MilestoneStatus.FUNDED, fundedAt: now }]);
  });
});
