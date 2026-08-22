import axios from 'axios';
import { config } from './config.js';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.botToken = config.TELEGRAM_BOT_TOKEN;
    this.chatId = config.TELEGRAM_CHAT_ID;
    this.enabled = config.USE_TELEGRAM && !!this.botToken && !!this.chatId;
  }

  /**
   * Sends a markdown formatted message to the configured Telegram chat.
   */
  public async sendMessage(text: string): Promise<boolean> {
    if (!this.enabled) {
      console.log(`[Telegram:Disabled] ${text}`);
      return false;
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    try {
      await axios.post(url, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML'
      }, { timeout: 8000 });
      return true;
    } catch (err: any) {
      console.error(`[Telegram] Failed to send message: ${err.message}`);
      return false;
    }
  }

  /**
   * Alert for Tier 2 confirmation requirement
   */
  public async alertHumanConfirmRequired(
    strategy: string,
    action: any,
    score: number,
    violations: string[],
    approvalId?: string
  ): Promise<void> {
    const approvalText = approvalId 
      ? `<b>Approval ID:</b> <code>${approvalId}</code>\n\n<i>Reply with <code>/brain approve ${approvalId}</code> or <code>/brain reject ${approvalId}</code></i>`
      : `<i>Reply with <code>/brain approve ${strategy}</code> or <code>/brain reject ${strategy}</code></i>`;

    const text = `
⚠️ <b>[STRATEGY BRAIN - TIER 2 CONFIRMATION REQUIRED]</b> ⚠️

<b>Strategy:</b> <code>${strategy}</code>
<b>Proposed Action:</b> <b>${action.name}</b> (${action.type})
<b>Score:</b> <b>${score}/100</b>
<b>Net Debit:</b> ₹${action.netDebitEstimate}
<b>Delta Impact:</b> ${action.netDeltaImpact}
<b>Structure Change:</b> ${action.changesStructureType ? 'YES' : 'NO'}

<b>Rationale:</b>
${action.rationale}

<b>Violations/Gates:</b>
${violations.map(v => `• ${v}`).join('\n') || 'None (Structure Shift)'}

${approvalText}
    `.trim();

    await this.sendMessage(text);
  }

  /**
   * Alert for Hard Panic or Tier 3 Escalation
   */
  public async alertHardStop(strategy: string, reason: string): Promise<void> {
    const text = `
🚨 <b>[STRATEGY BRAIN - HARD STOP / TIER 3]</b> 🚨

<b>Strategy:</b> <code>${strategy}</code>
<b>Status:</b> HALTED
<b>Reason:</b> ${reason}

<i>All autonomous actions blocked. Check .panic or daily cap limits.</i>
    `.trim();

    await this.sendMessage(text);
  }

  /**
   * Alert for execution outcome
   */
  public async alertExecutionOutcome(
    strategy: string,
    mode: 'PAPER' | 'LIVE',
    action: string,
    verified: boolean,
    details: string
  ): Promise<void> {
    const icon = verified ? '✅' : '❌';
    const text = `
${icon} <b>[STRATEGY BRAIN - ${mode} EXECUTION ${verified ? 'SUCCESS' : 'FAILED'}]</b>

<b>Strategy:</b> <code>${strategy}</code>
<b>Action:</b> ${action}
<b>Verified:</b> ${verified ? 'YES' : 'NO'}

<b>Details:</b>
${details}
    `.trim();

    await this.sendMessage(text);
  }

  /**
   * Registers a handler for /brain approve <id>
   */
  public handleApproveCommand(
    handler: (approvalId: string) => Promise<{ success: boolean; message: string }>
  ): (commandText: string) => Promise<string> {
    return async (commandText: string) => {
      const match = commandText.match(/^\/brain\s+approve\s+([a-zA-Z0-9_-]+)/);
      if (!match) {
        return 'Invalid format. Usage: /brain approve <approval_id>';
      }
      const res = await handler(match[1]);
      return res.message;
    };
  }

  /**
   * Registers a handler for /brain reject <id>
   */
  public handleRejectCommand(
    handler: (approvalId: string) => Promise<{ success: boolean; message: string }>
  ): (commandText: string) => Promise<string> {
    return async (commandText: string) => {
      const match = commandText.match(/^\/brain\s+reject\s+([a-zA-Z0-9_-]+)/);
      if (!match) {
        return 'Invalid format. Usage: /brain reject <approval_id>';
      }
      const res = await handler(match[1]);
      return res.message;
    };
  }
}
