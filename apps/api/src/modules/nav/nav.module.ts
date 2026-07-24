import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { DashboardSummaryService } from "./dashboard-summary.service.js";
import { NavCountsService } from "./nav-counts.service.js";
import { NavController } from "./nav.controller.js";

/**
 * Nav module (1c-3) — serves `GET /v1/me/nav-counts`, the read-only badge-count
 * aggregate for the authenticated app shell. Imports `AuthModule` (the
 * class-level `RolesGuard`'s deps) plus the two surface-owning modules it reads
 * through their exported services (`QuotesService`, `OrdersService` — never a
 * schema join, ADR 0032). It owns no schema, emits no events: a pure read seam,
 * so there is no repository/outbox/worker/privacy handler.
 *
 * Also serves `GET /v1/me/dashboard-summary` (ADR 0125), the owner "Přehled"
 * dashboard aggregate — the same read-through pattern via the same two services.
 */
@Module({
  imports: [AuthModule, QuotesModule, OrdersModule],
  controllers: [NavController],
  providers: [NavCountsService, DashboardSummaryService],
})
export class NavModule {}
