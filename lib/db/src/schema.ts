import { 
  pgTable, 
  serial, 
  integer, 
  varchar, 
  timestamp, 
  real 
} from 'drizzle-orm/pg-core';

// Referência fictícia à tabela de atletas caso ela já exista
// import { athletes } from './athletes'; 

export const shoes = pgTable('procoach_shoes', {
  id: serial('id').primaryKey(),
  
  // No Postgres, FKs geralmente apontam para id integer.
  // Ajuste para varchar/text se o seu athlete_id for string (ex: UUID).
  athleteId: integer('athlete_id').notNull(), 
  
  nickname: varchar('nickname', { length: 120 }).notNull(),
  brand: varchar('brand', { length: 80 }),
  model: varchar('model', { length: 120 }),
  startDate: varchar('start_date', { length: 32 }), // Formato YYYY-MM-DD
  
  // Uso 'real' (float) pois no app Flutter tratamos como 'double'
  initialKm: real('initial_km').notNull().default(0),
  currentKm: real('current_km').notNull().default(0), // Coluna para a soma atômica
  targetKm: real('target_km').notNull().default(500),
  
  // retiredAt nulo indica que o tênis está ATIVO
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const procoachRaces = pgTable('procoach_races', {
  id: serial('id').primaryKey(),
  athleteId: integer('athlete_id').notNull(), // FK para a tabela de atletas

  name: varchar('name', { length: 255 }).notNull(),
  date: varchar('date', { length: 32 }), // YYYY-MM-DD
  distancia: real('distancia'), // ex: 10, 21, 42.195
  type: varchar('type', { length: 50 }), // ex: P1, P2, P3
  isAnchor: integer('is_anchor').default(0), // 0 ou 1

  // --- NOVAS COLUNAS PARA RESULTADOS ---
  finishTime: varchar('finish_time', { length: 20 }), // ex: "58:07"
  finishPace: varchar('finish_pace', { length: 20 }), // ex: "5:48/km"
  weatherCondition: varchar('weather_condition', { length: 100 }), // ex: "☀️ 22°C"

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});