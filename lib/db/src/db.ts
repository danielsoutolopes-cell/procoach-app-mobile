import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema/index.js"; // Importa todos os seus schemas

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Em um ambiente de produção, você pode querer um tratamento de erro mais robusto
  // ou garantir que a variável de ambiente esteja sempre presente.
  throw new Error("DATABASE_URL is not set in lib/db/src/db.ts");
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
