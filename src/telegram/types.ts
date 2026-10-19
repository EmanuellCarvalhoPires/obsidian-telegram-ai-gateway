// The parts of the Telegram Bot API this plugin uses.
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  date?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface SendMessageParams {
  chat_id: string;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: InlineKeyboardMarkup;
  disable_notification?: boolean;
}

export interface EditMessageParams {
  chat_id: string;
  message_id: number;
  text: string;
  parse_mode?: "HTML";
  /** Omit to remove the buttons. */
  reply_markup?: InlineKeyboardMarkup;
}

export interface AnswerCallbackParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface GetUpdatesParams {
  offset?: number;
  limit?: number;
  /** Long polling timeout in seconds. */
  timeout?: number;
  allowed_updates?: string[];
}
