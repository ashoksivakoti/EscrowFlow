import type {
  ClientDashboard,
  DashboardPayload,
  FreelancerDashboard,
} from "../views/dashboard";

export type GetDashboardQuery = {
  /** When user has multiple roles, pick lens; server may default from primary role. */
  lens?: "CLIENT" | "FREELANCER" | "ADMIN";
};

export type GetDashboardResponse = {
  dashboard: DashboardPayload;
};

export type GetClientDashboardResponse = {
  dashboard: ClientDashboard;
};

export type GetFreelancerDashboardResponse = {
  dashboard: FreelancerDashboard;
};
