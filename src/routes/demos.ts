import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateServerToken } from '../middleware/serverAuth';
import { db } from '../config/database';
import { log } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import type { DbMatchRow } from '../types/database.types';

const router = Router();

// Directory for storing demos (same as database)
const DEMOS_DIR = path.join(process.cwd(), 'data', 'demos');

// Ensure demos directory exists
if (!fs.existsSync(DEMOS_DIR)) {
  fs.mkdirSync(DEMOS_DIR, { recursive: true });
  log.server(`Created demos directory: ${DEMOS_DIR}`);
}

/**
 * POST /api/demos/:matchSlug/upload
 * Upload demo file from MatchZy server
 * Protected by server token validation
 */
router.post('/:matchSlug/upload', validateServerToken, (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    // Get match details
    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

    if (!match) {
      res.status(404).json({
        success: false,
        error: `Match '${matchSlug}' not found`,
      });
      return;
    }

    // Get team names for filename
    const team1 = match.team1_id
      ? db.queryOne<{ name: string }>('SELECT name FROM teams WHERE id = ?', [match.team1_id])
      : null;
    const team2 = match.team2_id
      ? db.queryOne<{ name: string }>('SELECT name FROM teams WHERE id = ?', [match.team2_id])
      : null;

    // Get last map from events (map_result or series_end)
    const mapEvent = db.queryOne<{ event_data: string }>(
      `SELECT event_data FROM match_events 
       WHERE match_slug = ? AND event_type IN ('map_result', 'series_end') 
       ORDER BY received_at DESC LIMIT 1`,
      [matchSlug]
    );

    let mapName = 'unknown';
    if (mapEvent) {
      try {
        const eventData = JSON.parse(mapEvent.event_data);
        mapName = eventData.map_name || 'unknown';
      } catch {
        // Ignore parse errors
      }
    }

    // Get the uploaded file from request body (MatchZy sends binary data)
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);

        // Generate filename: {TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}.dem
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
        const team1Name = team1?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'TBD';
        const team2Name = team2?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'TBD';
        const cleanMap = mapName.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${timestamp}_${matchSlug}_${cleanMap}_${team1Name}_vs_${team2Name}.dem`;
        const filepath = path.join(DEMOS_DIR, filename);

        // Write file to disk
        fs.writeFileSync(filepath, buffer);

        // Update match with demo file path
        db.update('matches', { demo_file_path: filename }, 'slug = ?', [matchSlug]);

        log.success(`Demo uploaded for match ${matchSlug}`, {
          filename,
          size: buffer.length,
          teams: `${team1Name} vs ${team2Name}`,
        });

        res.json({
          success: true,
          message: 'Demo uploaded successfully',
          filename,
          size: buffer.length,
        });
      } catch (error) {
        log.error('Error saving demo file', error);
        res.status(500).json({
          success: false,
          error: 'Failed to save demo file',
        });
      }
    });

    req.on('error', (error) => {
      log.error('Error receiving demo upload', error);
      res.status(500).json({
        success: false,
        error: 'Failed to receive demo file',
      });
    });
  } catch (error) {
    log.error('Error processing demo upload', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process demo upload',
    });
  }
});

/**
 * GET /api/demos/:matchSlug/download
 * Download demo file for a match
 * Protected by API token
 */
router.get('/:matchSlug/download', requireAuth, (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    // Get match details
    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${matchSlug}' not found`,
      });
    }

    if (!match.demo_file_path) {
      return res.status(404).json({
        success: false,
        error: 'No demo file available for this match',
      });
    }

    const filepath = path.join(DEMOS_DIR, match.demo_file_path);

    if (!fs.existsSync(filepath)) {
      log.warn(`Demo file not found on disk: ${filepath}`);
      return res.status(404).json({
        success: false,
        error: 'Demo file not found on disk',
      });
    }

    log.debug(`Serving demo file: ${match.demo_file_path}`, { matchSlug });

    // Send file for download
    res.download(filepath, match.demo_file_path, (err) => {
      if (err) {
        log.error('Error sending demo file', err);
      }
    });
    return;
  } catch (error) {
    log.error('Error downloading demo', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download demo',
    });
    return;
  }
});

/**
 * GET /api/demos/:matchSlug/info
 * Get demo file info without downloading
 * Protected by API token
 */
router.get('/:matchSlug/info', requireAuth, (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    const match = db.queryOne<DbMatchRow>('SELECT demo_file_path FROM matches WHERE slug = ?', [
      matchSlug,
    ]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${matchSlug}' not found`,
      });
    }

    if (!match.demo_file_path) {
      return res.json({
        success: true,
        hasDemo: false,
      });
    }

    const filepath = path.join(DEMOS_DIR, match.demo_file_path);
    const exists = fs.existsSync(filepath);
    let fileSize = 0;

    if (exists) {
      const stats = fs.statSync(filepath);
      fileSize = stats.size;
    }

    res.json({
      success: true,
      hasDemo: exists,
      filename: match.demo_file_path,
      size: fileSize,
      sizeFormatted: `${(fileSize / 1024 / 1024).toFixed(2)} MB`,
    });
    return;
  } catch (error) {
    log.error('Error getting demo info', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get demo info',
    });
    return;
  }
});

export default router;

