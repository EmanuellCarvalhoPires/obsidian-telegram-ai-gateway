# Telegram AI Gateway

[English](#english) | [Português](#português)

---

## English

**Telegram AI Gateway** is an Obsidian plugin that enables AI agents (Claude Code, Antigravity) and automation scripts to send rich notifications and interactive approval requests with inline buttons to Telegram, with strict security controls and zero open network ports.

It operates as an integrated module of the [AI Ecosystem](https://github.com/EmanuellCarvalhoPires/obsidian-ai-ecosystem) and integrates seamlessly with [Environment Keys](https://github.com/EmanuellCarvalhoPires/obsidian-environment-variables) for encrypted credential storage and [AI Templates](https://github.com/EmanuellCarvalhoPires/obsidian-ai-templates) for structured Markdown templates.

### Key Features

- **No Open Network Ports:** In version 2.0.0, the standalone port 27125 is removed. All REST routes and MCP tools are routed through the single local server of the AI Ecosystem.
- **Asynchronous Approvals with Buttons:** Ask user confirmation via interactive Telegram buttons (`telegram_ask_approval`). Returns immediately with a pending ID; clients poll `telegram_get_approval` with a 25s wait window to await decisions without client timeouts.
- **Questions with Options and Typed Answers:** Ask the user one to four real questions (`telegram_ask_question`), each with two to four options as buttons, multiple choice and a free text answer. Same shape as Claude Code's `AskUserQuestion`. The question never expires unless you ask it to.
- **Remote Decision Recording:** Decisions can be made directly on your mobile device (via Telegram buttons) or resolved from the chat/terminal (`telegram_resolve_approval`), automatically updating the Telegram message status and removing buttons.
- **Environment Keys 2.0 Integration:** Keeps your Telegram bot token out of `data.json`. The token is stored encrypted in Environment Keys and referenced via placeholder (`{{secret:TELEGRAM_BOT_TOKEN}}`), ensuring it never appears in logs or inspector tools.
- **Dynamic AI Templates Integration:** Render rich templates when AI Templates is active (`template_id` + `data`).
- **Strict Security Controls:** Rate limiting (cooldown, per-minute, per-hour), quiet hours, recipient whitelisting, character limits, and AI prefixes.
- **Vault File Queue:** Offline scripts can drop JSON messages into a vault folder (default: `.telegram-queue`) for automatic transmission.
- **100% Native Obsidian UI:** Completely emoji-free interface following Obsidian's design system with Lucide icons.

### MCP Tools

| Tool | Description |
| --- | --- |
| `telegram_send_message` | Send a notification to Telegram. Accepts optional `template_id` and `data` when AI Templates is active. |
| `telegram_ask_approval` | Send a decision request with interactive buttons. Returns `{ id, status: "pending" }`. |
| `telegram_get_approval` | Poll for user decision (supports `wait` up to 25s for loop polling without timeouts). |
| `telegram_resolve_approval` | Resolve pending approval(s) directly from chat/terminal. |
| `telegram_ask_question` | Ask one to four questions with option buttons, multiSelect and free text. Returns `{ id, status: "pending" }`. |
| `telegram_get_question` | Poll the answers (supports `wait` up to 25s). When answered returns `answers` keyed by question text. |
| `telegram_resolve_question` | End pending question(s) as `answered_elsewhere` (answered on the PC) or `interrupted`, cleaning the Telegram messages. |

### REST Endpoints

All endpoints are hosted on the AI Ecosystem local server:
- `POST /api/v1/telegram-ai-gateway/send`
- `POST /api/v1/telegram-ai-gateway/approval`
- `GET /api/v1/telegram-ai-gateway/approval/:id?wait=25`
- `POST /api/v1/telegram-ai-gateway/resolve`
- `POST /api/v1/telegram-ai-gateway/question`
- `GET /api/v1/telegram-ai-gateway/question/:id?wait=25`
- `POST /api/v1/telegram-ai-gateway/question/resolve`
- `GET /api/v1/telegram-ai-gateway/status`

### Questions with options and typed answers

`telegram_ask_question` (REST: `POST /question`) takes `questions` (1 to 4; each with `question`, `header` of up to 12 characters, `options` 2 to 4 with `label` and optional `description`, and `multiSelect`) and the optional `allow_free_text` (default `true`), `expires_in_minutes`, `chat_id`, `title`, `context`, `urgent` and `silent`. It uses the same policy as approvals (AI sending allowed, quiet hours, rate limit, owner or allowed chat) and needs the bot token and the owner chat id; the `pedidos_aprovacao` notify event must be enabled.

- **Layout:** one message per question: bold header, the question, the options numbered with their descriptions and a status line. One button per option, plus `Other (type)` / `Outro (digitar)` when free text is allowed.
- **multiSelect:** each option button is a toggle (the label shows the mark) and a `Send` / `Enviar` button submits the selection. The answer is the list of labels.
- **Free text:** the button makes the bot ask for the text with a reply (force reply). Only a reply to that message, in the chat the question was sent to, counts; every other message is ignored. In a multiSelect question the typed text joins the selected options.
- **Statuses:** waiting, answered, expired and interrupted, shown in the message and kept in `data.json`. When the question ends, from any side, the messages are edited to the final status and lose their buttons. Pending questions survive a plugin reload and keep working.
- **Never expires by default:** a question only expires when `expires_in_minutes` is given (the approval expiry setting does not apply).
- **Answers:** `telegram_get_question` returns `{ status: "answered", answers: { "<question text>": "<label>" } }`; multiSelect gives a list of labels, typed text gives the text and also `free_text: { "<question text>": true }`.
- **Answered elsewhere:** call `telegram_resolve_question` with `answered_elsewhere` or `interrupted`, so no message stays at waiting.

Claude Code's `AskUserQuestion` hook can use these tools to send its questions to Telegram.

### Claude Code hooks and guided setup

The AI Ecosystem core can install Claude Code hooks and a setup skill for this module in the vault's `.claude/` folder:

- skill in `.claude/skills/configurar-telegram-ai-gateway/`, hook entries in `.claude/settings.local.json` (or `settings.json`), state in `.claude/ai-ecosystem/`, and a block in `GEMINI.md` for Antigravity.
- Modules downloaded from the AI Ecosystem module catalog show a confirmation screen listing what will be written before installing. Nothing in your own `.claude/` entries is overwritten.
- Until the guided setup finishes, the module's tools are hidden from Claude Code (other clients still see them).
- Hooks can be set to block, warn or off per module in the AI Ecosystem settings, and they fail open when Obsidian or the plugin is not running.

No protection hook for this module. The guided setup:

- The bot token is created by you in the Environment Keys create-secret screen (never typed in chat) as `TELEGRAM_BOT_TOKEN`; the setup key `token_secret` only receives the secret name.
- The chat id is discovered automatically: send `/start` to the bot. The first private chat becomes the owner, only while no owner is set, and Obsidian shows a notice.
- Other setup key: `eventos` (stored, informational for now).

---

## Português

**Telegram AI Gateway** é um plugin para Obsidian que permite que agentes de IA (Claude Code, Antigravity) e scripts de automação enviem notificações formatadas e pedidos de aprovação interativos com botões para o Telegram, com controles rigorosos de segurança e sem abrir portas próprias de rede.

Opera como módulo integrado do [AI Ecosystem](https://github.com/EmanuellCarvalhoPires/obsidian-ai-ecosystem), com integração nativa com o [Environment Keys](https://github.com/EmanuellCarvalhoPires/obsidian-environment-variables) para proteção de credenciais e com o [AI Templates](https://github.com/EmanuellCarvalhoPires/obsidian-ai-templates) para moldes de mensagens.

### Principais Recursos

- **Sem Portas de Rede Próprias:** Na versão 2.0.0, o servidor dedicado da porta 27125 foi removido. Todas as requisições REST e tools MCP passam pelo servidor unificado do AI Ecosystem.
- **Aprovações Assíncronas com Botões:** Envie perguntas com botões interativos (`telegram_ask_approval`). Responde imediatamente com ID pendente; clientes consultam `telegram_get_approval` com espera de até 25s por chamada, permitindo espera sem limite de tempo sem timeout de ferramentas.
- **Perguntas com Opções e Respostas Digitadas:** Faça de uma a quatro perguntas reais ao usuário (`telegram_ask_question`), cada uma com de duas a quatro opções como botões, escolha múltipla e resposta livre. Mesmo formato do `AskUserQuestion` do Claude Code. A pergunta nunca expira, a menos que você peça.
- **Resolução Flexível:** Decisões podem ser tomadas no celular (pelos botões do Telegram) ou pelo terminal/chat (`telegram_resolve_approval`), atualizando a mensagem com o marcador de status e removendo os botões.
- **Proteção pelo Environment Keys 2.0:** O token do bot é guardado criptografado no Environment Keys e substituído por placeholder (`{{secret:TELEGRAM_BOT_TOKEN}}`), nunca aparecendo em logs ou no inspetor.
- **Integração com AI Templates:** Renderização dinâmica de templates quando o AI Templates estiver ativo.
- **Controles Rigorosos:** Anti-loop (cooldown, limite por minuto e hora), horário de silêncio, restrição ao proprietário, limites de caracteres e prefixo de IA.
- **Fila de Arquivos no Cofre:** Scripts offline podem enviar mensagens gravando arquivos JSON na pasta do cofre (padrão: `.telegram-queue`).
- **UI 100% Nativa:** Interface sem emojis, utilizando ícones nativos Lucide via `setIcon`.

### Perguntas com opções e respostas digitadas

`telegram_ask_question` (REST: `POST /question`) recebe `questions` (de 1 a 4; cada uma com `question`, `header` de até 12 caracteres, `options` de 2 a 4 com `label` e `description` opcional, e `multiSelect`) e, opcionalmente, `allow_free_text` (padrão `true`), `expires_in_minutes`, `chat_id`, `title`, `context`, `urgent` e `silent`. Segue a mesma política das aprovações (envio de IA permitido, horário de silêncio, limite de envios, chat do dono ou permitido) e exige o token do bot e o chat id do dono; o evento `pedidos_aprovacao` precisa estar ativo.

- **Layout:** uma mensagem por pergunta: cabeçalho em negrito, a pergunta, as opções numeradas com as descrições e a linha de status. Um botão por opção, mais `Outro (digitar)` / `Other (type)` quando a resposta livre é permitida.
- **multiSelect:** cada botão de opção alterna a marca e o botão `Enviar` / `Send` envia a seleção. A resposta é a lista de rótulos.
- **Resposta livre:** o botão faz o bot pedir o texto com uma resposta (force reply). Só vale a resposta a essa mensagem, no chat para onde a pergunta foi enviada; qualquer outra mensagem é ignorada. Em pergunta multiSelect, o texto digitado entra junto com as opções marcadas.
- **Status:** aguardando, respondido, expirado e interrompido, mostrados na mensagem e guardados no `data.json`. Quando a pergunta termina, de qualquer lado, as mensagens são editadas para o status final e perdem os botões. Perguntas pendentes sobrevivem ao recarregamento do plugin e continuam funcionando.
- **Nunca expira por padrão:** a pergunta só expira se `expires_in_minutes` for informado (a configuração de expiração das aprovações não vale aqui).
- **Respostas:** `telegram_get_question` devolve `{ status: "answered", answers: { "<texto da pergunta>": "<rótulo>" } }`; multiSelect devolve uma lista de rótulos e o texto digitado devolve o texto e também `free_text: { "<texto da pergunta>": true }`.
- **Respondida em outro lugar:** chame `telegram_resolve_question` com `answered_elsewhere` ou `interrupted`, para nenhuma mensagem ficar em aguardando.
- **Tools e rotas:** `telegram_ask_question`, `telegram_get_question` e `telegram_resolve_question`; `POST /api/v1/telegram-ai-gateway/question`, `GET /api/v1/telegram-ai-gateway/question/:id?wait=25` e `POST /api/v1/telegram-ai-gateway/question/resolve`.

O hook do `AskUserQuestion` do Claude Code pode usar essas tools para mandar as perguntas ao Telegram.

### Hooks do Claude Code e configuração guiada

O núcleo AI Ecosystem pode instalar hooks do Claude Code e uma skill de configuração para este módulo na pasta `.claude/` do cofre:

- skill em `.claude/skills/configurar-telegram-ai-gateway/`, entradas de hook em `.claude/settings.local.json` (ou `settings.json`), estado em `.claude/ai-ecosystem/` e um bloco no `GEMINI.md` para o Antigravity.
- Módulos baixados do catálogo de módulos do AI Ecosystem mostram uma tela de confirmação com o que será gravado antes de instalar. Nada das suas entradas em `.claude/` é sobrescrito.
- Até a configuração guiada terminar, as tools do módulo ficam ocultas para o Claude Code (os outros clientes continuam vendo).
- Os hooks podem ficar em bloquear, avisar ou desligado por módulo nas configurações do AI Ecosystem, e liberam a chamada se o Obsidian ou o plugin não estiver rodando.

Este módulo não tem hook de proteção. A configuração guiada:

- O token do bot é criado por você na tela de criar secret do Environment Keys (nunca digitado no chat) como `TELEGRAM_BOT_TOKEN`; a chave `token_secret` recebe só o nome do secret.
- O chat id é descoberto sozinho: envie `/start` para o bot. A primeira conversa privada vira a dona, só enquanto não houver dona definida, e o Obsidian mostra um aviso.
- Outra chave: `eventos` (guardada, informativa por enquanto).

### Licença

MIT © [Emanuell Pires](https://github.com/EmanuellCarvalhoPires)
