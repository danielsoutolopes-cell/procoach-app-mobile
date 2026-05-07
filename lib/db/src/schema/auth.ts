import { boolean, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { athletesTable } from "./procoach.js";

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

export type OtpCode = typeof otpCodesTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;
