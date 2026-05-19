# Estrutura do Projeto ProCoach OS

Este documento descreve a arquitetura e os principais arquivos do projeto ProCoach OS, que é dividido em um aplicativo mobile (Flutter) e uma API de backend (Node.js/Express com Drizzle ORM).

## 📱 Aplicativo Mobile (Flutter)
O app segue uma arquitetura baseada em features (feature-driven) utilizando Riverpod para gerência de estado e GoRouter para navegação.

```text
c:\d\Coach-Pro\
├── lib/
│   ├── core/                        # Configurações centrais do app (Rotas, Network)
│   │   ├── network/dio_client.dart  # Configuração do cliente HTTP (Dio)
│   │   ├── providers/               # Providers globais (ex: GPS/Localização)
│   │   ├── router/
│   │   │   ├── app_router.dart      # Definição das rotas usando GoRouter
│   │   │   ├── scaffold_with_navbar.dart # Layout base com a BottomNavigationBar (5 abas)
│   │   │   └── plan_screen.dart     # Tela de visualização do Plano de Treino (Aba Plano)
│   │
│   ├── features/                    # Módulos divididos por contexto de negócio
│   │   ├── athlete/
│   │   │   ├── providers/
│   │   │   │   ├── athlete_provider.dart # Gerencia o estado global do Atleta (AsyncNotifier)
│   │   │   │   └── races_screen.dart     # Tela do calendário/histórico de provas (com cálculo de pace, resultados e IA)
│   │   │   ├── screens/add_race_screen.dart # Formulário para adicionar nova prova
│   │   │   └── services/athlete_service.dart # Chamadas de API relacionadas ao domínio do atleta
│   │   │
│   │   ├── dashboard/               # Aba Home (Tela inicial)
│   │   │   ├── screens/
│   │   │   │   ├── dashboard_screen.dart # Tela inicial com resumo diário (Provas, Treino, Clima)
│   │   │   │   └── next_workout_screen.dart # Tela detalhada da próxima sessão (Aba Próximo)
│   │   │   ├── providers/           # Providers de clima e treinos do dia
│   │   │   └── widgets/             # Cards da tela inicial (Clima, Treino, Spotify, Race Day)
│   │   │
│   │   └── status/                  # Aba de Manutenção / Stats
│   │       ├── screens/
│   │       │   ├── status_screen.dart # Resumo de volume, Recordes (PRs), Bioimpedância e Fichas de Força
│   │       │   └── import_screen.dart # Tela secundária dedicada para importar planilhas (JSON/PDF)
│   │       ├── providers/           # Providers de compliance, histórico bioimpedância e catálogo de força
│   │       ├── services/bioimpedance_service.dart # API para upload de PDF de bioimpedância para análise IA
│   │       └── widgets/weekly_volume_chart.dart # Gráfico em barras de volume e métricas
│   │
│   └── shared/                      # Código compartilhado por todo o app
│       ├── models/                  # Classes de dados (Athlete, Workout, PlanSession, etc.)
│       │   ├── athlete.dart         # Dados do atleta, PRs e inventário
│       │   ├── workout.dart         # Modelo do treino do dia
│       │   ├── plan_session.dart    # Modelo de sessão de plano importado
│       │   └── plan_provider.dart   # Provedor do cronograma com lógica de cache e seleção
│       └── widgets/async_value_widget.dart # Componente utilitário para renderizar loading/erro do Riverpod
│
├── pubspec.yaml                     # Dependências do app Flutter (Riverpod, Dio, GoRouter, fl_chart, etc.)
└── Manual_do_Usuario_ProCoachOS_Android.txt # Manual e documentação de regras de negócio do app
```

## ⚙️ Servidor API (Node.js / Express)
O backend é construído com Express.js e lida com persistência no banco de dados Neon (PostgreSQL) usando Drizzle ORM.

```text
c:\d\Coach-Pro\
├── artifacts/api-server/src/routes/ # Lógica de negócio e Endpoints da API (Refatorados na V6.1)
│   ├── index.ts                     # Ponto de entrada das rotas (agregador dos routers modulares)
│   ├── procoach.ts                  # Rota central moderna (Cadastro, Sync, Perfil, IA Strategy, Clima atual)
│   ├── procoach-utils.ts            # Funções utilitárias compartilhadas (Telegram, Clima Histórico/Previsão, IA, Utilitários de data)
│   ├── procoach-legacy.ts           # Rotas antigas suportadas por `deviceId` (Retrocompatibilidade)
│   ├── races.ts                     # Gerenciamento de Provas, Âncora do Macrociclo e salvamento de Resultados
│   ├── plan.ts                      # Importadores (JSON, PDF, Txt) e extração do cronograma
│   ├── bio.ts                       # Upload de PDF de Bioimpedância (extração Gemini) e Histórico do usuário
│   ├── strength.ts                  # Backend da Biblioteca de Fichas de Força (A/B/C) e catálogo de exercícios
│   ├── inventory.ts                 # Controle de Estoque de Géis e controle/arquivamento de Tênis (Shoes)
│   ├── reports.ts                   # Geração de PDFs Semanais (pdfkit), Compliance e Briefings Noturnos (Telegram/Email)
│   ├── PlanParserService.ts         # Motor inteligente de inferência e cálculo de paces/km/telemetria de treinos brutos
│   ├── strava.ts / stravaWebhook.ts # Integração OAuth e sincronização nativa de atividades com o Strava
│   └── migrations.ts                # Helpers de segurança para criação de tabelas e colunas em tempo real (runtime)
│
├── lib/db/src/                      # Camada de Dados (Monorepo DB Workspace)
│   └── schema.ts                    # Declaração tipada das tabelas do Drizzle ORM (procoach_athletes, races, workout_entries, shoes, etc.)
│
├── tsconfig.json                    # Configurações de compilação do TypeScript
└── package.json                     # Scripts de build, tipagens e dependências do projeto (Express, Drizzle, etc.)
```

---
*Documentação gerada para a versão base ProCoach OS V6.1.*