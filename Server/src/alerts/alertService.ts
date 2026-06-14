import type { AppConfig } from '../app/config.js'

const ALERT_HTTP_TIMEOUT_MS = 10_000

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertEvent = {
  key: string
  severity: AlertSeverity
  title: string
  message: string
  metadata?: Record<string, unknown>
}

type AlertPayload = {
  key: string
  severity: AlertSeverity
  title: string
  message: string
  metadata: Record<string, unknown>
  occurredAt: string
  source: string
}

const severityPrefix: Record<AlertSeverity, string> = {
  info: 'INFO',
  warning: 'WARNING',
  critical: 'CRITICAL',
}

const compact = (value: string) => value.trim()

export class AlertService {
  private readonly lastSentByKey = new Map<string, number>()

  constructor(private readonly config: AppConfig) {}

  async notify(event: AlertEvent) {
    if (!this.config.ALERTS_ENABLED) {
      return
    }

    const now = Date.now()
    const previousSentAt = this.lastSentByKey.get(event.key) ?? 0
    if (now - previousSentAt < this.config.ALERT_COOLDOWN_MS) {
      return
    }

    this.lastSentByKey.set(event.key, now)

    const payload = this.buildPayload(event, now)
    const tasks: Array<Promise<void>> = []

    if (this.config.ALERT_SLACK_WEBHOOK_URL) {
      tasks.push(this.sendSlack(payload))
    }

    if (this.hasTwilioChannel()) {
      tasks.push(this.sendTwilioWhatsapp(payload))
    }

    if (this.config.ALERT_EMAIL_WEBHOOK_URL) {
      tasks.push(this.sendEmailWebhook(payload))
    }

    if (!tasks.length) {
      return
    }

    const results = await Promise.allSettled(tasks)
    const failures = results.filter((result) => result.status === 'rejected')

    if (!failures.length) {
      return
    }

    failures.forEach((failure) => {
      if (failure.status === 'rejected') {
        console.error('[alert-service] alert delivery failed', failure.reason)
      }
    })

    // Allow immediate retry on the next trigger if every channel failed.
    if (failures.length === results.length) {
      this.lastSentByKey.delete(event.key)
    }
  }

  private buildPayload(event: AlertEvent, now: number): AlertPayload {
    return {
      key: event.key,
      severity: event.severity,
      title: compact(event.title),
      message: compact(event.message),
      metadata: event.metadata ?? {},
      occurredAt: new Date(now).toISOString(),
      source: 'derton-finance-server',
    }
  }

  private hasTwilioChannel() {
    return Boolean(
      this.config.ALERT_WHATSAPP_TWILIO_ACCOUNT_SID.trim() &&
        this.config.ALERT_WHATSAPP_TWILIO_AUTH_TOKEN.trim() &&
        this.config.ALERT_WHATSAPP_TWILIO_FROM.trim() &&
        this.config.ALERT_WHATSAPP_TWILIO_TO.trim(),
    )
  }

  private async sendSlack(payload: AlertPayload) {
    const metadataRows = Object.entries(payload.metadata)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n')

    const text = [
      `[${severityPrefix[payload.severity]}] ${payload.title}`,
      payload.message,
      `Source: ${payload.source}`,
      `Time: ${payload.occurredAt}`,
      metadataRows ? `Details:\n${metadataRows}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    await this.postJson(this.config.ALERT_SLACK_WEBHOOK_URL, {
      text,
    })
  }

  private async sendTwilioWhatsapp(payload: AlertPayload) {
    const sid = this.config.ALERT_WHATSAPP_TWILIO_ACCOUNT_SID.trim()
    const token = this.config.ALERT_WHATSAPP_TWILIO_AUTH_TOKEN.trim()
    const from = this.withWhatsappPrefix(this.config.ALERT_WHATSAPP_TWILIO_FROM)
    const to = this.withWhatsappPrefix(this.config.ALERT_WHATSAPP_TWILIO_TO)
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`
    const body = new URLSearchParams({
      From: from,
      To: to,
      Body: this.toPlainText(payload),
    })

    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    await this.postForm(endpoint, body, {
      Authorization: `Basic ${auth}`,
    })
  }

  private async sendEmailWebhook(payload: AlertPayload) {
    const headers: Record<string, string> = {}
    const token = this.config.ALERT_EMAIL_WEBHOOK_TOKEN.trim()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const recipients = this.config.ALERT_EMAIL_TO.split(',').map((item) => item.trim()).filter(Boolean)

    await this.postJson(
      this.config.ALERT_EMAIL_WEBHOOK_URL,
      {
        subject: `[${severityPrefix[payload.severity]}] ${payload.title}`,
        text: this.toPlainText(payload),
        from: this.config.ALERT_EMAIL_FROM.trim() || undefined,
        to: recipients.length ? recipients : undefined,
        event: payload,
      },
      headers,
    )
  }

  private withWhatsappPrefix(value: string) {
    const trimmed = value.trim()
    if (!trimmed) {
      return trimmed
    }

    return trimmed.toLowerCase().startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`
  }

  private toPlainText(payload: AlertPayload) {
    const metadataRows = Object.entries(payload.metadata)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n')

    return [
      `[${severityPrefix[payload.severity]}] ${payload.title}`,
      payload.message,
      `Source: ${payload.source}`,
      `Time: ${payload.occurredAt}`,
      metadataRows ? `Details:\n${metadataRows}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private async postJson(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ALERT_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 300)}` : ''}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async postForm(url: string, body: URLSearchParams, extraHeaders: Record<string, string> = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ALERT_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...extraHeaders,
        },
        body: body.toString(),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 300)}` : ''}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

