/**
 * Event Logger - Persistent file logging for all MatchZy webhook events
 * Logs are stored in data/logs/events/ for debugging and recovery
 */

import fs from 'fs';
import path from 'path';
import { MatchZyEvent } from '../types/matchzy-events.types';

// Logs live under the api/data directory to keep the repo root clean
const LOGS_DIR = path.join(__dirname, '..', '..', 'data', 'logs', 'events');
const ALL_EVENTS_FILE = path.join(LOGS_DIR, 'events-all.txt');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Log a webhook event to file
 * Creates daily log files: events-YYYY-MM-DD.log
 */
export function logWebhookEvent(serverId: string, matchSlug: string, event: MatchZyEvent): void {
  try {
    // Get current date for filename
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `events-${dateStr}.log`;
    const filepath = path.join(LOGS_DIR, filename);

    // Format log entry
    const timestamp = date.toISOString();
    const logEntry = {
      timestamp,
      serverId,
      matchSlug,
      eventType: event.event,
      event,
    };

    // Write to file (append mode)
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(filepath, logLine, 'utf8');
    fs.appendFileSync(ALL_EVENTS_FILE, logLine, 'utf8');
  } catch (error) {
    // Don't let logging errors crash the API
    console.error('Failed to write event to log file:', error);
  }
}

/**
 * Clean up old log files (optional - keep last 30 days)
 */
export function cleanupOldLogs(daysToKeep = 30): void {
  try {
    const files = fs.readdirSync(LOGS_DIR);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    files.forEach((file) => {
      if (!file.startsWith('events-') || !file.endsWith('.log')) {
        return;
      }

      // Extract date from filename: events-YYYY-MM-DD.log
      const dateMatch = file.match(/events-(\d{4}-\d{2}-\d{2})\.log/);
      if (!dateMatch) return;

      const fileDate = new Date(dateMatch[1]);
      if (fileDate < cutoffDate) {
        const filepath = path.join(LOGS_DIR, file);
        fs.unlinkSync(filepath);
        console.log(`Deleted old event log: ${file}`);
      }
    });
  } catch (error) {
    console.error('Failed to cleanup old logs:', error);
  }
}

