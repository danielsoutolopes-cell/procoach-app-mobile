import {
  boolean,
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

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

export const otpCodesTable = pgTable("procoach_otp_codes", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  used: boolean("used").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const authSessionsTable = pgTable("procoach_auth_sessions", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id")
    .notNull()
    .references(() => athletesTable.id, { onDelete: "cascade" }),
  phone: varchar("phone", { length: 20 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  deviceId: varchar("device_id", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
