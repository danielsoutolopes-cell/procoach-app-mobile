import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod"; // Certifique-se de ter drizzle-zod instalado

export const workoutTypeEnum = pgEnum("workout_type", [
  "corrida",
  "bike",
  "regenerativo",
  "forca",
  "folga",
]);

export const athletesTable = pgTable("procoach_athletes", {
  id: serial("id").primaryKey(),
  deviceId: varchar("device_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull().default("Atleta"),
  targetRaceName: varchar("target_race_name", { length: 200 })
    .notNull()
    .default("Maratona São Paulo"),
  targetRaceDate: varchar("target_race_date", { length: 32 }).notNull(),
  targetRaceDistanceKm: integer("target_race_distance_km").notNull().default(42),
  hrv: integer("hrv").notNull().default(68),
  painLevel: integer("pain_level").notNull().default(0),
  currentWeek: integer("current_week").notNull().default(1),
  expoPushToken: varchar("expo_push_token", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const shoesTable = pgTable("procoach_shoes", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id")
    .notNull()
    .references(() => athletesTable.id, { onDelete: "cascade" }),
  nickname: varchar("nickname", { length: 120 }).notNull(),
  brand: varchar("brand", { length: 80 }),
  model: varchar("model", { length: 120 }),
  startDate: varchar("start_date", { length: 32 }),
  initialKm: integer("initial_km").notNull().default(0),
  targetKm: integer("target_km").notNull().default(500),
  retiredAt: timestamp("retired_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workoutEntriesTable = pgTable("procoach_workout_entries", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id")
    .notNull()
    .references(() => athletesTable.id, { onDelete: "cascade" }),
  entryDate: varchar("entry_date", { length: 32 }).notNull(),
  distanceKm: integer("distance_km").notNull().default(0),
  type: workoutTypeEnum("type").notNull(),
  durationMin: integer("duration_min").notNull().default(0),
  week: integer("week").notNull(),
  shoeId: integer("shoe_id").references(() => shoesTable.id, { onDelete: "set null" }),
  source: varchar("source", { length: 16 }).notNull().default("manual"),
  externalId: bigint("external_id", { mode: "number" }),
  injuryAlert: varchar("injury_alert", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const weeklyStatsTable = pgTable("procoach_weekly_stats", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id")
    .notNull()
    .references(() => athletesTable.id, { onDelete: "cascade" }),
  week: integer("week").notNull(),
  completedKm: integer("completed_km").notNull().default(0),
  sessionsCount: integer("sessions_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAthleteSchema = createInsertSchema(athletesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectAthleteSchema = createSelectSchema(athletesTable);

export const insertWorkoutEntrySchema = createInsertSchema(
  workoutEntriesTable
).omit({ id: true, createdAt: true });

export const insertWeeklyStatsSchema = createInsertSchema(
  weeklyStatsTable
).omit({ id: true, updatedAt: true });

export type Athlete = typeof athletesTable.$inferSelect;
export type InsertAthlete = Omit<
  typeof athletesTable.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export type WorkoutEntry = typeof workoutEntriesTable.$inferSelect;
export type InsertWorkoutEntry = Omit<
  typeof workoutEntriesTable.$inferInsert,
  "id" | "createdAt"
>;

export type WeeklyStat = typeof weeklyStatsTable.$inferSelect;

export type Shoe = typeof shoesTable.$inferSelect;
export type InsertShoe = typeof shoesTable.$inferInsert;
