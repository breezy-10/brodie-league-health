import type { Adapter } from "./types";
import { crmAdapter } from "./adapters/crm";
import { facilitiesAdapter } from "./adapters/facilities";
import { refPayrollAdapter } from "./adapters/ref-payroll";
import { trainingAdapter } from "./adapters/training";
import { statsHealthAdapter } from "./adapters/stats-health";
import { contentHealthAdapter } from "./adapters/content-health";
import { opsScheduleAdapter } from "./adapters/ops-schedule";

export const ADAPTERS: Adapter[] = [
  crmAdapter,
  facilitiesAdapter,
  refPayrollAdapter,
  trainingAdapter,
  statsHealthAdapter,
  contentHealthAdapter,
  opsScheduleAdapter,
];
