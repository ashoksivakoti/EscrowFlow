import { describe, expect, it } from "vitest";

import { evaluateEmergencyAdminCancelPreflight } from "@/components/admin/emergency-admin-cancel-panel";

describe("evaluateEmergencyAdminCancelPreflight", () => {
  it("allows execution only when project is active with no blockers", () => {
    const decision = evaluateEmergencyAdminCancelPreflight({
      projectStatusCode: 0,
      submittedMilestones: [],
      approvedMilestones: [],
      activeDisputeMilestones: [],
    });
    expect(decision.canExecute).toBe(true);
    expect(decision.reasons).toHaveLength(0);
  });

  it("blocks when active disputes, submitted, or approved milestones exist", () => {
    const decision = evaluateEmergencyAdminCancelPreflight({
      projectStatusCode: 0,
      submittedMilestones: [2],
      approvedMilestones: [3],
      activeDisputeMilestones: [1],
    });
    expect(decision.canExecute).toBe(false);
    expect(decision.reasons.join(" ")).toContain("Active disputes");
    expect(decision.reasons.join(" ")).toContain("Submitted milestone");
    expect(decision.reasons.join(" ")).toContain("Approved milestone");
  });

  it("blocks when project is not active", () => {
    const decision = evaluateEmergencyAdminCancelPreflight({
      projectStatusCode: 2,
      submittedMilestones: [],
      approvedMilestones: [],
      activeDisputeMilestones: [],
    });
    expect(decision.canExecute).toBe(false);
    expect(decision.reasons).toContain("Project is not Active on-chain.");
  });
});
