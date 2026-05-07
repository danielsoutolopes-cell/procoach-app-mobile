// Re-exporta a instância do banco de dados (ajuste o caminho se necessário)
export { db } from "./db.js"; // Exporta explicitamente a constante db

// Re-exporta operadores comuns para garantir consistência de tipos no monorepo
export { eq, and, or, desc, asc, sql, gte, gt, lte, lt, not, inArray } from "drizzle-orm";
