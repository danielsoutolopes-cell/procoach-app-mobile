# PROCOACH OS V5.1 — Workspace

## Overview

pnpm workspace monorepo usando TypeScript. Ecossistema de alta performance para corredores com app mobile, backend Express e PostgreSQL Neon.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL Neon + Drizzle ORM (lib/db)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Mobile**: Expo / React Native (artifacts/procoach-os)
- **Build**: esbuild (CJS bundle)

## Artifacts

| Artifact | Tipo | Path |
|---|---|---|
| PROCOACH OS V5.1 | Expo Mobile | artifacts/procoach-os |
| API Server | Express/Node | artifacts/api-server |

## Database (Neon PostgreSQL)

Connection via `NEON_DATABASE_URL` env var (shared environment).

### Tabelas ProCoach
- `procoach_athletes` — perfil do atleta, VFC, dor, semana atual
- `procoach_workout_entries` — histórico de treinos (distanceKm sempre INTEGER)
- `procoach_weekly_stats` — volume semanal acumulado por semana

### Regra de Ouro: Quilometragem Inteira
`distanceKm` é **sempre Math.round()** — no cliente (Expo) e no servidor (Express).
Ex: 12.7km → 13km armazenado e exibido.

## API Endpoints (/api/procoach/...)

| Método | Rota | Descrição |
|---|---|---|
| POST | /athletes/sync | Cria ou atualiza atleta por deviceId |
| GET | /athletes/:deviceId | Busca perfil do atleta |
| POST | /athletes/:deviceId/workouts | Registra treino concluído |
| GET | /athletes/:deviceId/workouts | Histórico de treinos |
| GET | /athletes/:deviceId/weekly-stats | Volume km por semana |

## Regras de Negócio Implementadas

1. **Quilometragem Inteira**: Math.round() em frontend e backend
2. **Matriz de 16 Semanas**: 4 blocos × 4 semanas (Base → Construção → Pico → Polimento)
3. **Prioridade de Prova P1**: Calendário gerado retroativamente a partir da data da prova alvo
4. **Prevenção de Lesões**: VFC < 55ms ou Dor > 0 → sugere "Bike Indolor" ou "Treino Regenerativo"
5. **Sync Offline-First**: dados salvos localmente (AsyncStorage) + sincronizados com Neon
6. **Recuperação Pós-Prova**: `POST /api/procoach/post-race-recovery` gera 3–5 dias de plano de recuperação via GPT-4o-mini após finalizar uma prova. Block armazenado em AsyncStorage (`@procoach_recovery_block_v1`). Substituí card de treino normal por `RecoveryBlockCard` durante o período de recuperação.
7. **PDF Semanal**: Botão "EXPORTAR PDF" no painel de sessões do PLANO. Gera HTML com todas sessões, paces extraídos, estratégia de géis por sessão longa (≥10km) e tabela de referência de paces. No web: abre nova aba (imprimível). No nativo: `expo-print` → PDF → `expo-sharing`.

## Key Commands

- `pnpm run typecheck` — typecheck completo em todos os pacotes
- `pnpm --filter @workspace/db run push` — push do schema ao Neon (usar NEON_DATABASE_URL)
- `pnpm --filter @workspace/api-server run dev` — rodar API server localmente

## Arquitetura Mobile (Expo)

```
artifacts/procoach-os/
  app/(tabs)/
    index.tsx      — Dashboard: Treino do Dia
    plano.tsx      — Matriz 16 semanas
    provas.tsx     — Calendário retroativo P1
    historico.tsx  — Gráfico de volume + histórico
    status.tsx     — VFC, Dor, Prevenção de Lesões
  context/
    AthleteContext.tsx  — Estado global + sync com API
  services/
    api.ts         — Cliente HTTP para o backend
  utils/
    training.ts    — Lógica de negócio (phases, km rounding)
    deviceId.ts    — ID único por dispositivo (AsyncStorage)
  constants/
    colors.ts      — Dark theme: #0A0A0A / #1A1A1A / #FF5F00
```
