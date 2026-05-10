# ProCoach OS — Provas (Âncora do Macrociclo), Aderência (Corrida ≥ 3km) e Telegram 22h

Data: 2026-05-10

## Contexto
Hoje o app:
- Mostra “Próxima prova” e “Próxima P1 (alvo)” com regras baseadas em data/prioridade.
- Calcula aderência/volumes incluindo atividades que poluem o dado (ex.: caminhada, bike) e corridas muito curtas.
- O Telegram 22h não envia automaticamente sem um agendamento externo confiável.

Decisões aprovadas:
- Provas: **Opção A** — permitir múltiplas P1/P2/P3 e introduzir **Âncora do Macrociclo** separada da prioridade.
- Aderência: **Opção A** — considerar **somente corridas com distância ≥ 3km** em **Histórico + Compliance**.
- Telegram: **Opção A** — agendar via **GitHub Actions cron** chamando o endpoint `/api/telegram/nightly`.

## Objetivos
- Permitir ver e gerenciar **todas as provas cadastradas**.
- Distinguir claramente:
  - “Próxima prova (calendário)” (por data)
  - “Macrociclo (âncora)” (prova escolhida manualmente)
  - “Próxima P1” (próxima corrida com prioridade P1 por data, apenas para referência)
- Melhorar a qualidade da aderência removendo ruído (apenas corrida ≥ 3km).
- Garantir briefing Telegram às 22h (São Paulo) com confiabilidade.

## Não-objetivos
- Regras de inferência automática de tênis via Strava.
- OCR de PDFs escaneados (somente PDF com tabela).

---

## 1) Provas — Âncora do Macrociclo

### 1.1 Modelo de dados (app)
Adicionar ao perfil:
- `macrocycleRaceId: string | null`

Regras:
- `macrocycleRaceId` aponta para um item de `profile.races[]`.
- Se nulo:
  - fallback para “próxima P1 por data”
  - se não houver P1 futura, fallback para próxima prova por data

### 1.2 UI (aba Provas)
Adicionar na parte superior:
- **Próxima prova:** próxima corrida por data (independente de prioridade).
- **Macrociclo (âncora):** prova definida por `macrocycleRaceId`.
- **Próxima P1 (referência):** próxima prova com `priority === P1` (por data).

Lista:
- Sessão “Todas as provas” (substitui/expande o recorte atual)
  - Ordenação padrão: por data asc (futuras primeiro), depois passadas.
  - Filtros rápidos: `Todas | P1 | P2 | P3 | Passadas`
  - Ações: editar, arquivar (soft delete) ou remover.

Edição/criação:
- Campo “Definir como âncora do macrociclo” (toggle).
  - Ao ativar: seta `macrocycleRaceId = race.id`.
  - Ao desativar: mantém `macrocycleRaceId` inalterado (a âncora só muda explicitamente).

### 1.3 Derivação de semana/fase
Todas as funções que calculam semana do ciclo (matriz de 16 semanas) devem usar:
- `anchorDateISO = races.find(id === macrocycleRaceId)?.date || fallback`

---

## 2) Aderência — Corrida ≥ 3km (Histórico + Compliance)

### 2.1 Definição “atividade válida para aderência”
Uma entrada é “válida” quando:
- `type === "corrida"`
- `distanceKm >= 3`

### 2.2 Histórico
- Gráficos de volume/aderência e totais devem usar apenas entradas válidas.
- O histórico bruto (lista completa) pode continuar existindo para auditoria, mas:
  - os indicadores/volume semanal devem ignorar não-corridas e corridas < 3km.

### 2.3 Compliance (Status)
No cálculo de “concluído” (sessões e km):
- Concluído deve somar apenas entradas válidas.

Planejado permanece igual:
- “Planejado” vem do plano importado (cronograma/plan_sessions).

---

## 3) Telegram 22h — GitHub Actions cron

### 3.1 Endpoints existentes
Servidor já expõe:
- `POST /api/telegram/nightly` com header `x-cron-secret`

Variáveis necessárias:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_CRON_SECRET`

### 3.2 Agendamento (GitHub Actions)
Criar workflow:
- `.github/workflows/telegram-nightly.yml`
- Cron diário em UTC equivalente a 22:00 São Paulo
- Executa `curl`:
  - `POST https://coach-pro-v8e4.onrender.com/api/telegram/nightly`
  - header `x-cron-secret: ${{ secrets.TELEGRAM_CRON_SECRET }}`

Observação:
- Cron em UTC precisa ser documentado no repo (mudança de horário pode exigir ajuste).

### 3.3 Alternativa de emergência (manual)
Permitir disparo manual via workflow_dispatch no GitHub Actions para testes.

---

## Critérios de aceite
- Aba Provas mostra todas as provas cadastradas e permite definir “Âncora do Macrociclo”.
- “Macrociclo (âncora)” dita a semana/fase exibida no app.
- Histórico e Compliance param de contar bike/caminhada e corridas < 3km.
- Telegram envia briefing 22h diariamente via Actions (com execução manual de teste).

