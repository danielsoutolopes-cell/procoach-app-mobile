# 📜 ProCoach OS: Contexto de Sistema e Lógica de Negócio

## 1. Stack Tecnológica (Confirmada)
O ecossistema é operado sob uma arquitetura de monorepo gerenciada por `pnpm workspaces`, garantindo consistência de tipos entre o Cérebro (Backend) e os Membros (Frontend).

-   **Frontend Mobile**: React Native via **Expo (SDK 52+)**, utilizando Router (Tabs) e Context API para gerenciamento de estado global.
-   **Backend**: **Node.js com Express 5**, focado em endpoints de telemetria e integração com serviços de IA.
-   **Persistência**: **PostgreSQL (hospedado no Neon DB)**.
-   **ORM**: **Drizzle ORM**, utilizado para definição de schema, migrações e consultas tipadas.
-   **Validação**: **Zod**, atuando na blindagem de payloads e geração automática de contratos de dados via `drizzle-zod`.

## 2. Fluxo de Dados e Telemetria
O ProCoach OS opera sob um modelo **Master-State**, onde a "Verdade" reside no banco de dados central e o App mobile reflete esse estado para consumo do atleta.

1.  **Input Primário**: Ocorre majoritariamente via **automações externas (Telegram/Scripts)** que alimentam as tabelas de biometria (`hrv`, `painLevel`) e registros de treinos no Neon DB.
2.  **Sincronização**: O frontend realiza um `POST /api/procoach/athletes/sync` no boot para alinhar o estado local (`AsyncStorage`) com o servidor via `deviceId`.
3.  **Processamento**: O backend processa a **Matriz de 16 Semanas**, calculando fases (Base, Construção, Pico, Polimento) com base na data da prova **P1 (Prova Alvo)**.
4.  **Consumo Visual**: O frontend consome esses agregados para renderizar cards dinâmicos, gráficos de volume (`WeeklyVolumeChart`) e relatórios de logística de prova.

## 3. Padrões de Tipagem e Contratos (Drizzle + Zod)
A tipagem é rigorosa para evitar falhas em ambiente de produção (APK).

-   **Schemas de Banco (`lib/db`)**: Tabelas como `procoach_athletes`, `workout_entries` e `weekly_stats` definem a estrutura fundamental.
-   **Inferência de Tipos**: Utilizamos `InferSelectModel` e `InferInsertModel` do Drizzle para garantir que as interfaces de objeto no frontend sejam idênticas às colunas do PostgreSQL.
-   **Validação Zod**: O arquivo `lib/db/src/schema/procoach.ts` utiliza `createInsertSchema` para validar as entradas da API.
-   **Interface de UI (`AthleteProfile`)**: No frontend, o tipo `AthleteProfile` estende o modelo básico do banco para incluir o array de objetos `Race[]`, permitindo a lógica de priorização P1/P2/P3.

## 4. Regras Críticas de Negócio e UX

### A "Regra de Ouro" (Quilometragem Inteira)
Toda telemetria de distância é tratada como **Integer**. O sistema aplica `Math.round()` tanto no interceptor da API (`api.ts`) quanto no processamento do banco de dados. 12.7km é armazenado e visualizado como 13km.

### Visual-First, Input-Light
O frontend do ProCoach OS **não é um CRUD tradicional**. 
-   **Regra**: Não devem ser criados formulários complexos de edição de perfil no app.
-   **Propósito**: O app é um painel de consulta tática. O atleta abre o app para ver o "Treino do Dia", o "Pace Alvo" ajustado pelo clima e a logística de géis.
-   **Exceção**: O log de treinos concluídos é permitido, mas segue um fluxo simplificado.

### Calendário Retroativo P1
Toda a lógica de tempo do sistema (Semana 1 a 16) é calculada **para trás** a partir da data da Prova P1. Se a data da P1 mudar, o sistema deve recalcular automaticamente em qual semana o atleta se encontra.

---

### Notas para o Trae IDE:
*   Ao gerar o APK, garanta que as variáveis `EXPO_PUBLIC_API_URL` estejam apontando para a instância de produção no Render.
*   Mantenha a tipagem `any` estritamente limitada aos callbacks da biblioteca `victory-native`, onde há conflitos de overload conhecidos.
*   Priorize a performance de renderização do `Dashboard` (index.tsx), pois é a tela de maior acesso sob condições de fadiga do atleta.