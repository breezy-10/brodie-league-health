import type { Adapter } from "./types";
import { crmAdapter } from "./adapters/crm";
import { facilitiesAdapter } from "./adapters/facilities";
import { refPayrollAdapter } from "./adapters/ref-payroll";
import { trainingAdapter } from "./adapters/training";
import { statsHealthAdapter } from "./adapters/stats-health";
import { contentHealthAdapter } from "./adapters/content-health";
import { checklistAdapter } from "./adapters/checklist";
import { feedbackAdapter } from "./adapters/feedback";
// ops_schedule adapter is intentionally NOT exported until the source app
// is built out. Re-add it here + flip apps.enabled when ready.
// import { opsScheduleAdapter } from "./adapters/ops-schedule";

export const ADAPTERS: Adapter[] = [
  crmAdapter,
  facilitiesAdapter,
  refPayrollAdapter,
  trainingAdapter,
  statsHealthAdapter,
  contentHealthAdapter,
  checklistAdapter,
  feedbackAdapter,
];
