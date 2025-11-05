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
 * Follows MatchZy recommended pattern with streaming
 */
router.post('/:matchSlug/upload', validateServerToken, (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    // Read MatchZy headers
    const matchzyFilename = req.header('MatchZy-FileName');
    const matchzyMatchId = req.header('MatchZy-MatchId');
    const matchzyMapNumber = req.header('MatchZy-MapNumber');

    log.debug('Demo upload started', {
      matchSlug,
      filename: matchzyFilename,
      matchId: matchzyMatchId,
      mapNumber: matchzyMapNumber,
    });

    // Get match details
    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

    if (!match) {
      log.warn(`Demo upload rejected: Match ${matchSlug} not found`);
      res.status(404).json({
        success: false,
        error: `Match '${matchSlug}' not found`,
      });
      return;
    }

    // Create match-specific folder (following MatchZy pattern)
    const matchFolder = path.join(DEMOS_DIR, matchSlug);
    if (!fs.existsSync(matchFolder)) {
      fs.mkdirSync(matchFolder, { recursive: true });
    }

    // Use MatchZy's filename if provided, otherwise generate our own
    let filename: string;
    if (matchzyFilename) {
      filename = matchzyFilename;
    } else {
      // Fallback: Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
      const mapNumber = matchzyMapNumber || '0';
      filename = `${timestamp}_${matchSlug}_map${mapNumber}.dem`;
    }

    const filepath = path.join(matchFolder, filename);

    // Create write stream (following MatchZy pattern)
    const writeStream = fs.createWriteStream(filepath);

    // Pipe the request body into the stream (efficient streaming)
    req.pipe(writeStream);

    // Wait for request to end and reply with 200
    req.on('end', () => {
      writeStream.end();

      // Update match with demo file path (store relative path)
      const relativePath = path.join(matchSlug, filename);
      db.update('matches', { demo_file_path: relativePath }, 'slug = ?', [matchSlug]);

      log.success(`Demo uploaded for match ${matchSlug}`, {
        filename,
        matchId: matchzyMatchId,
        mapNumber: matchzyMapNumber,
        path: relativePath,
      });

      res.status(200).json({
        success: true,
        message: 'Demo uploaded successfully',
        filename,
      });
    });

    // If there is a problem writing the file, reply with 500
    writeStream.on('error', (err) => {
      log.error('Error writing demo file', err);
      res.status(500).json({
        success: false,
        error: 'Error writing demo file: ' + err.message,
      });
    });

    // Handle request errors
    req.on('error', (error) => {
      log.error('Error receiving demo upload', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to receive demo file',
        });
      }
    });
  } catch (error) {
    log.error('Error processing demo upload', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to process demo upload',
      });
    }
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

    // Handle both old flat structure and new folder structure
    let filepath = path.join(DEMOS_DIR, match.demo_file_path);
    
    // If file doesn't exist and path doesn't include folder, try legacy flat path
    if (!fs.existsSync(filepath) && !match.demo_file_path.includes(path.sep)) {
      filepath = path.join(DEMOS_DIR, matchSlug, match.demo_file_path);
    }

    if (!fs.existsSync(filepath)) {
      log.warn(`Demo file not found on disk: ${filepath}`);
      return res.status(404).json({
        success: false,
        error: 'Demo file not found on disk',
      });
    }

    log.debug(`Serving demo file: ${match.demo_file_path}`, { matchSlug });

    // Extract just filename for download
    const downloadFilename = path.basename(match.demo_file_path);

    // Send file for download
    res.download(filepath, downloadFilename, (err) => {
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

    // Handle both old flat structure and new folder structure
    let filepath = path.join(DEMOS_DIR, match.demo_file_path);
    
    // If file doesn't exist and path doesn't include folder, try legacy flat path
    if (!fs.existsSync(filepath) && !match.demo_file_path.includes(path.sep)) {
      filepath = path.join(DEMOS_DIR, matchSlug, match.demo_file_path);
    }

    const exists = fs.existsSync(filepath);
    let fileSize = 0;

    if (exists) {
      const stats = fs.statSync(filepath);
      fileSize = stats.size;
    }

    res.json({
      success: true,
      hasDemo: exists,
      filename: path.basename(match.demo_file_path),
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

