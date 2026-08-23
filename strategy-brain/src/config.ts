import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from current directory or root workspace
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const ConfigSchema = z.object({
  // Environment & Modes
  NODE_ENV: z.string().default('development'),
  PAPER_MODE: z.boolean().default(true),
  LIVE_ENABLED: z.boolean().default(false),
  LIVE_EXECUTION_ALLOWED: z.boolean().default(false),

  // LLM Config
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_TEMPERATURE_DECISION: z.number().default(0.2),
  LLM_TEMPERATURE_RESEARCH: z.number().default(0.6),

  // Web Search Config
  SEARCH_API_ENDPOINT: z.string().optional().default(''),
  SEARCH_API_KEY: z.string().optional().default(''),

  // Execution Caps & Safety Limits
  MAX_ORDERS_PER_CYCLE: z.number().default(4),
  MAX_NET_PREMIUM_DEBIT: z.number().default(25000), // in INR
  MAX_DELTA_CHANGE_PER_ADJUSTMENT: z.number().default(0.30),
  MAX_ADJUSTMENTS_PER_STRATEGY_DAY: z.number().default(1),
  MAX_ADJUSTMENTS_PER_STRATEGY_WEEK: z.number().default(3),
  DANGER_THRESHOLD_FACTOR: z.number().default(0.50), // 50% of exit threshold
  WALL_DISTANCE_POINTS: z.number().default(50), // 50 points to short strike
  
  // Broker Config
  ANGEL_CLIENT_ID: z.string().optional().default(''),
  ANGEL_PASSWORD: z.string().optional().default(''),
  ANGEL_TOTP_SECRET: z.string().optional().default(''),
  ANGEL_API_KEY: z.string().optional().default(''),
  ANGEL_PUBLIC_IP: z.string().default('103.160.108.203'),
  SCRIP_MASTER_PATH: z.string().default('/home/ubuntu/niftyicifalgo/scrip_master.json'),
  FULL_SCRIP_MASTER_PATH: z.string().default('./data/full-scrip-master.json'),
  FULL_SCRIP_MASTER_TTL_HOURS: z.number().default(24),
  STRATEGY_PREFIX: z.string().optional().default(''),

  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
  USE_TELEGRAM: z.boolean().default(true),

  // Data Lake Paths
  DATA_LAKE_PATH: z.string().default('/home/ubuntu/niftyicifalgo/data/chains/'),
  SENSEX_DATA_LAKE_PATH: z.string().default('/home/ubuntu/niftyicifalgo/data/sensex-chains/'),

  // Paths
  PLAYBOOK_DIR: z.string().default('./playbook'),
  LEDGER_DIR: z.string().default('./ledger'),
  REVIEW_DIR: z.string().default('./review'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PAPER_MODE: process.env.PAPER_MODE !== 'false', // Default ON
  LIVE_ENABLED: process.env.LIVE_ENABLED === 'true',
  LIVE_EXECUTION_ALLOWED: process.env.LIVE_EXECUTION_ALLOWED === 'true',
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_TEMPERATURE_DECISION: process.env.LLM_TEMPERATURE_DECISION ? parseFloat(process.env.LLM_TEMPERATURE_DECISION) : undefined,
  LLM_TEMPERATURE_RESEARCH: process.env.LLM_TEMPERATURE_RESEARCH ? parseFloat(process.env.LLM_TEMPERATURE_RESEARCH) : undefined,
  SEARCH_API_ENDPOINT: process.env.SEARCH_API_ENDPOINT,
  SEARCH_API_KEY: process.env.SEARCH_API_KEY,
  MAX_ORDERS_PER_CYCLE: process.env.MAX_ORDERS_PER_CYCLE ? parseInt(process.env.MAX_ORDERS_PER_CYCLE, 10) : undefined,
  MAX_NET_PREMIUM_DEBIT: process.env.MAX_NET_PREMIUM_DEBIT ? parseFloat(process.env.MAX_NET_PREMIUM_DEBIT) : undefined,
  MAX_DELTA_CHANGE_PER_ADJUSTMENT: process.env.MAX_DELTA_CHANGE_PER_ADJUSTMENT ? parseFloat(process.env.MAX_DELTA_CHANGE_PER_ADJUSTMENT) : undefined,
  MAX_ADJUSTMENTS_PER_STRATEGY_DAY: process.env.MAX_ADJUSTMENTS_PER_STRATEGY_DAY ? parseInt(process.env.MAX_ADJUSTMENTS_PER_STRATEGY_DAY, 10) : undefined,
  MAX_ADJUSTMENTS_PER_STRATEGY_WEEK: process.env.MAX_ADJUSTMENTS_PER_STRATEGY_WEEK ? parseInt(process.env.MAX_ADJUSTMENTS_PER_STRATEGY_WEEK, 10) : undefined,
  DANGER_THRESHOLD_FACTOR: process.env.DANGER_THRESHOLD_FACTOR ? parseFloat(process.env.DANGER_THRESHOLD_FACTOR) : undefined,
  WALL_DISTANCE_POINTS: process.env.WALL_DISTANCE_POINTS ? parseFloat(process.env.WALL_DISTANCE_POINTS) : undefined,
  ANGEL_CLIENT_ID: process.env.ANGEL_CLIENT_ID || process.env.BROKER_CLIENT_ID,
  ANGEL_PASSWORD: process.env.ANGEL_PASSWORD || process.env.BROKER_PASSWORD,
  ANGEL_TOTP_SECRET: process.env.ANGEL_TOTP_SECRET || process.env.BROKER_TOTP_SECRET,
  ANGEL_API_KEY: process.env.ANGEL_API_KEY || process.env.BROKER_API_KEY,
  ANGEL_PUBLIC_IP: process.env.ANGEL_PUBLIC_IP,
  SCRIP_MASTER_PATH: process.env.SCRIP_MASTER_PATH,
  FULL_SCRIP_MASTER_PATH: process.env.FULL_SCRIP_MASTER_PATH,
  FULL_SCRIP_MASTER_TTL_HOURS: process.env.FULL_SCRIP_MASTER_TTL_HOURS ? parseFloat(process.env.FULL_SCRIP_MASTER_TTL_HOURS) : undefined,
  STRATEGY_PREFIX: process.env.STRATEGY_PREFIX,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  USE_TELEGRAM: process.env.USE_TELEGRAM ? process.env.USE_TELEGRAM === 'true' : true,
  DATA_LAKE_PATH: process.env.DATA_LAKE_PATH,
  SENSEX_DATA_LAKE_PATH: process.env.SENSEX_DATA_LAKE_PATH,
  PLAYBOOK_DIR: process.env.PLAYBOOK_DIR,
  LEDGER_DIR: process.env.LEDGER_DIR,
  REVIEW_DIR: process.env.REVIEW_DIR,
});
