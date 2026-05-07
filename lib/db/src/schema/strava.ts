import { bigint, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { athletesTable } from "./procoach.js";

export const stravaTokensTable = pgTable("procoach_strava_tokens", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id")
    .notNull()
    .references(() => athletesTable.id, { onDelete: "cascade" })
    .unique(),
  stravaAthleteId: bigint("strava_athlete_id", { mode: "number" }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at"),
});

export type StravaToken = typeof stravaTokensTable.$inferSelect;
