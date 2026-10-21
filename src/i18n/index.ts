// Interface strings in English and Portuguese. Uses native Obsidian getLanguage().
import { getLanguage } from "obsidian";

export type Lang = "en" | "pt";

export interface StringTable {
  en: Record<string, string>;
  pt: Record<string, string>;
}

const strings: StringTable = {
  en: {
    // Core & Commands
    "core.ribbon.title": "Telegram AI Gateway",
    "core.cmd.sendActiveNote": "Send active note to Telegram",
    "core.cmd.sendSelection": "Send selected text to Telegram",
    "core.cmd.sendCustom": "Send custom message to Telegram",
    "core.cmd.testConnection": "Test connection and send test message",
    "core.notice.sent": "Telegram message sent successfully.",
    "core.notice.failed": "Failed to send Telegram message: {error}",
    "core.notice.noSelection": "No text selected.",
    "core.notice.emptyMessage": "Please enter a message.",
    "core.notice.noFile": "No active note to send.",
    "core.notice.noToken": "Telegram bot token is not configured.",
    "core.notice.noChatId": "Owner Chat ID is not configured.",
    "core.notice.ownerDiscovered": "Telegram AI Gateway: owner chat registered from /start.",
    "core.notice.testing": "Testing Telegram connection...",
    "core.notice.testSuccess": "Connection test successful! Message sent.",

    // Dependency modal
    "dependency.title": "AI Ecosystem is required",
    "dependency.body":
      "Telegram AI Gateway runs as a module of AI Ecosystem. It uses the unified server for REST routes and MCP tools, with zero open network ports.",
    "dependency.standby":
      "Telegram AI Gateway stays in standby until AI Ecosystem is installed and enabled, and connects automatically as soon as it starts.",
    "dependency.install": "Install and enable AI Ecosystem",
    "dependency.openPage": "Open plugin page",
    "dependency.installed": "AI Ecosystem installed and enabled.",
    "dependency.failed": "Could not install automatically. Opening the plugin page.",

    // Status & States
    "status.connected": "Telegram Gateway: connected",
    "status.waiting": "Telegram Gateway: waiting for AI Ecosystem",
    "status.disconnected": "Telegram Gateway: disconnected",
    "status.missing": "Telegram Gateway: no AI Ecosystem",
    "status.incompatible": "Telegram Gateway: incompatible",
    "status.polling": "Polling for decisions",
    "status.conflict": "Conflict: another client is polling this bot",
    "status.webhook": "Conflict: webhook is enabled on Telegram bot",
    "status.unauthorized": "Unauthorized: invalid bot token",
    "status.tokenUnavailable": "Bot token unavailable ({detail})",

    // Token states
    "token.none": "Not configured",
    "token.plaintext": "Plaintext (stored in data.json)",
    "token.envKeys": "Protected in Environment Keys",
    "token.envKeysMissing": "Environment Keys not installed or disabled",
    "token.vaultLocked": "Environment Keys secret vault is locked",
    "token.adoptSuccess": "Token moved into Environment Keys.",
    "token.adoptBtn": "Move token into Environment Keys",
    "token.adoptBtnDesc": "Store this token encrypted in Environment Keys and replace it with a placeholder.",

    // Settings tab - Headings
    "settings.ecosystem.heading": "AI Ecosystem integration",
    "settings.bot.heading": "Telegram Bot credentials",
    "settings.policy.heading": "AI security controls & rate limits",
    "settings.approvals.heading": "Approvals & message settings",
    "settings.queue.heading": "Vault file queue",
    "settings.history.heading": "Recent transmission history",

    // Settings tab - Ecosystem
    "settings.ecosystem.connectedDesc": "Module registered. Single server and MCP tools active.",
    "settings.ecosystem.waitingDesc": "AI Ecosystem is starting. Telegram AI Gateway will register automatically.",
    "settings.ecosystem.disconnectedDesc": "AI Ecosystem was unloaded. Telegram AI Gateway will reconnect when it returns.",
    "settings.ecosystem.missingDesc": "Install or enable AI Ecosystem to expose Telegram tools to AI agents.",
    "settings.ecosystem.incompatibleDesc": "Incompatible Provider API: {reason}",

    // Settings tab - Bot
    "settings.bot.token": "Bot token",
    "settings.bot.tokenDesc": "Token provided by @BotFather. Stored encrypted when Environment Keys is active.",
    "settings.bot.tokenPlaceholder": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ or {{secret:NAME}}",
    "settings.bot.chatId": "Owner Chat ID",
    "settings.bot.chatIdDesc": "Your Telegram numeric user ID or chat ID.",
    "settings.bot.chatIdPlaceholder": "e.g. 123456789",
    "settings.bot.testBtn": "Test connection",

    // Settings tab - Policy
    "settings.policy.allowAi": "Allow AI agents to send messages",
    "settings.policy.allowAiDesc": "Master switch to allow or block messages sent by Claude Code, Antigravity and scripts.",
    "settings.policy.restrictOwner": "Restrict to owner only",
    "settings.policy.restrictOwnerDesc": "Forces all AI messages to be sent to your Owner Chat ID only.",
    "settings.policy.allowedChatIds": "Allowed Chat IDs",
    "settings.policy.allowedChatIdsDesc": "Comma-separated list of chat IDs allowed when owner-only is disabled.",
    "settings.policy.maxPerHour": "Max messages per hour",
    "settings.policy.maxPerMin": "Max messages per minute",
    "settings.policy.cooldown": "Minimum cooldown between messages (seconds)",
    "settings.policy.maxChars": "Max characters per message",
    "settings.policy.enablePrefix": "Enable AI message prefix",
    "settings.policy.aiPrefix": "AI message prefix",
    "settings.policy.aiPrefixDesc": "Text prepended to messages sent by AI agents.",
    "settings.policy.quietHours": "Enable quiet hours",
    "settings.policy.quietHoursDesc": "Block non-urgent AI messages during sleep or focus time.",
    "settings.policy.quietHoursStart": "Quiet hours start",
    "settings.policy.quietHoursEnd": "Quiet hours end",
    "settings.policy.allowUrgentQuiet": "Allow urgent messages during quiet hours",

    // Settings tab - Approvals
    "settings.approvals.expiry": "Approval expiry (minutes)",
    "settings.approvals.expiryDesc": "Time until pending approval requests expire without decision (0 = never).",
    "settings.approvals.language": "Message language",
    "settings.approvals.languageDesc": "Language for status markers and texts written into Telegram messages.",
    "settings.approvals.templates": "Allow AI Templates",
    "settings.approvals.templatesDesc": "Allows agents to render templates via AI Templates plugin.",
    "settings.approvals.templatesActive": "AI Templates is active and available.",
    "settings.approvals.templatesInactive": "AI Templates is not active. Template parameters are disabled.",

    // Questions (telegram_ask_question): errors returned to the agent
    "question.error.noToken": "The Telegram bot token is not configured in the plugin.",
    "question.error.noOwner": "The owner Chat ID is not configured in the plugin. Send /start to the bot first.",
    "question.error.disabled": "Questions are disabled in the plugin setup (pedidos_aprovacao is not among the notified events).",
    "question.error.questionsRequired": "'questions' must be a list with {min} to {max} questions.",
    "question.error.notObject": "Question {n} must be an object with question, options and optional header, multiSelect.",
    "question.error.questionText": "Question {n}: 'question' must be a non-empty text of up to {max} characters.",
    "question.error.questionDuplicate": "Question {n} repeats the text of another question. Each question text must be unique, because the answers are keyed by it.",
    "question.error.header": "Question {n}: 'header' must be a text of up to {max} characters.",
    "question.error.options": "Question {n}: 'options' must be a list with {min} to {max} options.",
    "question.error.optionLabel": "Question {n}, option {o}: 'label' must be a non-empty text of up to {max} characters.",
    "question.error.optionDescription": "Question {n}, option {o}: 'description' must be a text of up to {max} characters.",
    "question.error.optionDuplicate": "Question {n}: two options have the label '{label}'. Labels must be unique.",
    "question.error.multiSelect": "Question {n}: 'multiSelect' must be true or false.",
    "question.error.title": "'title' must be a text of up to {max} characters.",
    "question.error.context": "'context' must be a text of up to {max} characters.",
    "question.error.notFound": "Question request not found: {id}",
    "question.error.invalidStatus": "Invalid status: {status}. Allowed: answered_elsewhere, interrupted.",
    "question.error.nothingToResolve": "No pending question to resolve.",

    // Settings tab - Queue
    "settings.queue.enable": "Enable vault file queue",
    "settings.queue.enableDesc": "Allows offline scripts to queue messages by dropping JSON files into the vault.",
    "settings.queue.path": "Queue folder path",

    // Settings tab - History
    "settings.history.empty": "No recent messages.",
    "settings.history.thTime": "Time",
    "settings.history.thSender": "Sender",
    "settings.history.thStatus": "Outcome",
    "settings.history.thRecipient": "Recipient",
    "settings.history.thSnippet": "Snippet",

    // Custom message modal
    "modal.custom.title": "Send message via Telegram",
    "modal.custom.placeholder": "Type your message here...",
    "modal.custom.send": "Send",
    "modal.custom.cancel": "Cancel",
  },
  pt: {
    // Core & Commands
    "core.ribbon.title": "Telegram AI Gateway",
    "core.cmd.sendActiveNote": "Enviar nota ativa para meu Telegram",
    "core.cmd.sendSelection": "Enviar texto selecionado para meu Telegram",
    "core.cmd.sendCustom": "Enviar mensagem personalizada para meu Telegram",
    "core.cmd.testConnection": "Testar conexão e enviar mensagem teste no Telegram",
    "core.notice.sent": "Mensagem enviada com sucesso ao Telegram.",
    "core.notice.failed": "Falha ao enviar mensagem ao Telegram: {error}",
    "core.notice.noSelection": "Nenhum texto selecionado.",
    "core.notice.emptyMessage": "Por favor, digite uma mensagem.",
    "core.notice.noFile": "Nenhuma nota ativa para enviar.",
    "core.notice.noToken": "Token do bot do Telegram não configurado.",
    "core.notice.noChatId": "Chat ID do proprietário não configurado.",
    "core.notice.ownerDiscovered": "Telegram AI Gateway: chat do dono registrado pelo /start.",
    "core.notice.testing": "Testando conexão com o Telegram...",
    "core.notice.testSuccess": "Teste de conexão concluído! Mensagem enviada.",

    // Dependency modal
    "dependency.title": "O AI Ecosystem é obrigatório",
    "dependency.body":
      "O Telegram AI Gateway funciona como um módulo do AI Ecosystem. Ele utiliza o servidor local unificado para rotas REST e tools MCP, sem abrir portas próprias de rede.",
    "dependency.standby":
      "O Telegram AI Gateway permanece em espera até que o AI Ecosystem seja instalado e ativado, conectando-se automaticamente assim que ele iniciar.",
    "dependency.install": "Instalar e ativar o AI Ecosystem",
    "dependency.openPage": "Abrir página do plugin",
    "dependency.installed": "AI Ecosystem instalado e ativado com sucesso.",
    "dependency.failed": "Não foi possível instalar automaticamente. Abrindo a página do plugin.",

    // Status & States
    "status.connected": "Telegram Gateway: conectado",
    "status.waiting": "Telegram Gateway: aguardando o AI Ecosystem",
    "status.disconnected": "Telegram Gateway: desconectado",
    "status.missing": "Telegram Gateway: sem o AI Ecosystem",
    "status.incompatible": "Telegram Gateway: incompatível",
    "status.polling": "Escutando decisões no Telegram",
    "status.conflict": "Conflito: outro cliente está escutando este bot",
    "status.webhook": "Conflito: webhook ativo no bot do Telegram",
    "status.unauthorized": "Não autorizado: token inválido",
    "status.tokenUnavailable": "Token do bot indisponível ({detail})",

    // Token states
    "token.none": "Não configurado",
    "token.plaintext": "Texto puro (salvo no data.json)",
    "token.envKeys": "Protegido no Environment Keys",
    "token.envKeysMissing": "Environment Keys não instalado ou desativado",
    "token.vaultLocked": "Cofre do Environment Keys bloqueado",
    "token.adoptSuccess": "Token movido para o Environment Keys com sucesso.",
    "token.adoptBtn": "Mover token para o Environment Keys",
    "token.adoptBtnDesc": "Guarda este token criptografado no Environment Keys e o substitui por um placeholder.",

    // Settings tab - Headings
    "settings.ecosystem.heading": "Integração com o AI Ecosystem",
    "settings.bot.heading": "Credenciais do Bot Telegram",
    "settings.policy.heading": "Controles de segurança e limites para IA",
    "settings.approvals.heading": "Configurações de mensagens e aprovações",
    "settings.queue.heading": "Fila de arquivos no cofre",
    "settings.history.heading": "Histórico recente de transmissões",

    // Settings tab - Ecosystem
    "settings.ecosystem.connectedDesc": "Módulo registrado. Servidor unificado e tools MCP ativos.",
    "settings.ecosystem.waitingDesc": "O AI Ecosystem está iniciando. O módulo se registrará automaticamente.",
    "settings.ecosystem.disconnectedDesc": "O AI Ecosystem foi desativado. Reconectará quando voltar.",
    "settings.ecosystem.missingDesc": "Instale ou ative o AI Ecosystem para expor o Telegram para agentes de IA.",
    "settings.ecosystem.incompatibleDesc": "Versão da Provider API incompatível: {reason}",

    // Settings tab - Bot
    "settings.bot.token": "Token do Bot",
    "settings.bot.tokenDesc": "Token fornecido pelo @BotFather. Fica criptografado com o Environment Keys ativo.",
    "settings.bot.tokenPlaceholder": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ ou {{secret:NOME}}",
    "settings.bot.chatId": "Chat ID do Proprietário",
    "settings.bot.chatIdDesc": "Seu ID numérico de usuário ou chat no Telegram.",
    "settings.bot.chatIdPlaceholder": "ex: 123456789",
    "settings.bot.testBtn": "Testar conexão",

    // Settings tab - Policy
    "settings.policy.allowAi": "Permitir envio por agentes de IA",
    "settings.policy.allowAiDesc": "Chave geral para permitir ou bloquear mensagens de Claude Code, Antigravity e scripts.",
    "settings.policy.restrictOwner": "Restringir apenas ao proprietário",
    "settings.policy.restrictOwnerDesc": "Força todas as mensagens de IA a serem enviadas apenas para o seu Chat ID.",
    "settings.policy.allowedChatIds": "Chat IDs permitidos",
    "settings.policy.allowedChatIdsDesc": "Lista separada por vírgulas de IDs permitidos quando o modo restrito está desligado.",
    "settings.policy.maxPerHour": "Máximo de mensagens por hora",
    "settings.policy.maxPerMin": "Máximo de mensagens por minuto",
    "settings.policy.cooldown": "Intervalo mínimo entre mensagens (segundos)",
    "settings.policy.maxChars": "Máximo de caracteres por mensagem",
    "settings.policy.enablePrefix": "Habilitar prefixo de IA",
    "settings.policy.aiPrefix": "Prefixo de mensagens da IA",
    "settings.policy.aiPrefixDesc": "Texto adicionado no início das mensagens enviadas por agentes de IA.",
    "settings.policy.quietHours": "Habilitar horário de silêncio",
    "settings.policy.quietHoursDesc": "Bloqueia mensagens não urgentes durante horários de descanso ou foco.",
    "settings.policy.quietHoursStart": "Início do horário de silêncio",
    "settings.policy.quietHoursEnd": "Fim do horário de silêncio",
    "settings.policy.allowUrgentQuiet": "Permitir mensagens urgentes no silêncio",

    // Settings tab - Approvals
    "settings.approvals.expiry": "Expiração de aprovações (minutos)",
    "settings.approvals.expiryDesc": "Tempo limite para expirar pedidos pendentes sem decisão (0 = sem expiração).",
    "settings.approvals.language": "Idioma das mensagens",
    "settings.approvals.languageDesc": "Idioma das etiquetas de status e textos escritos dentro das mensagens do Telegram.",
    "settings.approvals.templates": "Permitir AI Templates",
    "settings.approvals.templatesDesc": "Permite que agentes usem templates pelo plugin AI Templates.",
    "settings.approvals.templatesActive": "AI Templates está ativo e disponível.",
    "settings.approvals.templatesInactive": "AI Templates não está ativo. Parâmetros de template desativados.",

    // Perguntas (telegram_ask_question): erros devolvidos ao agente
    "question.error.noToken": "O token do bot do Telegram não está configurado no plugin.",
    "question.error.noOwner": "O Chat ID do dono não está configurado no plugin. Envie /start para o bot primeiro.",
    "question.error.disabled": "As perguntas estão desativadas na configuração do plugin (pedidos_aprovacao não está entre os eventos notificados).",
    "question.error.questionsRequired": "'questions' deve ser uma lista com {min} a {max} perguntas.",
    "question.error.notObject": "A pergunta {n} deve ser um objeto com question, options e, opcionalmente, header e multiSelect.",
    "question.error.questionText": "Pergunta {n}: 'question' deve ser um texto não vazio de até {max} caracteres.",
    "question.error.questionDuplicate": "A pergunta {n} repete o texto de outra pergunta. Cada texto deve ser único, porque as respostas são indexadas por ele.",
    "question.error.header": "Pergunta {n}: 'header' deve ser um texto de até {max} caracteres.",
    "question.error.options": "Pergunta {n}: 'options' deve ser uma lista com {min} a {max} opções.",
    "question.error.optionLabel": "Pergunta {n}, opção {o}: 'label' deve ser um texto não vazio de até {max} caracteres.",
    "question.error.optionDescription": "Pergunta {n}, opção {o}: 'description' deve ser um texto de até {max} caracteres.",
    "question.error.optionDuplicate": "Pergunta {n}: duas opções têm o rótulo '{label}'. Os rótulos devem ser únicos.",
    "question.error.multiSelect": "Pergunta {n}: 'multiSelect' deve ser true ou false.",
    "question.error.title": "'title' deve ser um texto de até {max} caracteres.",
    "question.error.context": "'context' deve ser um texto de até {max} caracteres.",
    "question.error.notFound": "Pedido de pergunta não encontrado: {id}",
    "question.error.invalidStatus": "Status inválido: {status}. Permitidos: answered_elsewhere, interrupted.",
    "question.error.nothingToResolve": "Nenhuma pergunta pendente para resolver.",

    // Settings tab - Queue
    "settings.queue.enable": "Habilitar fila de arquivos no cofre",
    "settings.queue.enableDesc": "Permite que scripts offline enviem mensagens gravando arquivos JSON no cofre.",
    "settings.queue.path": "Caminho da pasta da fila",

    // Settings tab - History
    "settings.history.empty": "Nenhuma mensagem recente.",
    "settings.history.thTime": "Horário",
    "settings.history.thSender": "Remetente",
    "settings.history.thStatus": "Resultado",
    "settings.history.thRecipient": "Destinatário",
    "settings.history.thSnippet": "Trecho",

    // Custom message modal
    "modal.custom.title": "Enviar mensagem via Telegram",
    "modal.custom.placeholder": "Digite sua mensagem aqui...",
    "modal.custom.send": "Enviar",
    "modal.custom.cancel": "Cancelar",
  },
};

let forced: Lang | undefined;

/** For tests. */
export function setLanguage(lang: Lang | undefined): void {
  forced = lang;
}

export function currentLanguage(): Lang {
  if (forced) return forced;
  try {
    return getLanguage().toLowerCase().startsWith("pt") ? "pt" : "en";
  } catch {
    return "en";
  }
}

/** Translates a key, replacing {name} with vars.name. Falls back to English, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = currentLanguage();
  let text = strings[lang][key] ?? strings.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** All keys, for tests that verify both languages. */
export function allStrings(): StringTable {
  return strings;
}
