import express, { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { validateServerToken } from '../../../middleware/serverAuth';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { settingsService } from '../../../services/settingsService';
import { emitMatchUpdate } from '../../../services/socketService';
import { getMapResults } from '../../../services/matchMapResultService';
import path from 'path';
import fs from 'fs';
import type { DbMatchRow } from '../../../types/database.types';
import { demoMatchIdFromHeader } from '../../../utils/serverAttribution';
import { DATA_DIR } from '../../../config/dataDir';

const router = Router();

// Directory for storing demos (same as database) - under DATA_DIR, so it
// survives container recreates (see config/dataDir.ts).
const DEMOS_DIR = path.join(DATA_DIR, 'demos');

// Ensure demos directory exists
if (!fs.existsSync(DEMOS_DIR)) {
  fs.mkdirSync(DEMOS_DIR, { recursive: true });
  log.server(`Created demos directory: ${DEMOS_DIR}`);
}

/**
 * POST /api/demos/:matchSlug/upload
 * Upload demo file from Auto Tournament CS2 server
 * Protected by server token validation
 * Follows Auto Tournament CS2 API specification for demo uploads
 * 
 * Headers expected:
 * - Auto-Tournament-FileName (required)
 * - Auto-Tournament-MatchId (required)
 * - Auto-Tournament-MapNumber (required)
 * - Auto-Tournament-RoundNumber (always present)
 * - Get5-* headers (compatibility, always present)
 */
router.post(
  '/:matchSlug/upload',
  validateServerToken,
  // CRITICAL: Use express.raw() to handle binary data correctly
  // This follows Auto Tournament CS2 API specification exactly
  express.raw({ type: 'application/octet-stream', limit: '500mb' }),
  async (req: Request, res: Response) => {
    const { matchSlug: urlMatchSlug } = req.params;
    // The slug the demo is stored under. Starts as the URL slug and is replaced
    // by the match the Auto-Tournament-MatchId header names, once resolved below.
    let matchSlug = urlMatchSlug;

    try {
      // Read Auto Tournament CS2 headers (with Get5 fallbacks for compatibility)
      // Headers are normalized to lowercase by Express
      // Headers can be string | string[], so we take the first value if it's an array
      const getHeaderValue = (value: string | string[] | undefined): string | undefined => {
        if (Array.isArray(value)) {
          return value[0];
        }
        return value;
      };

      const atFilename =
        getHeaderValue(req.headers['auto-tournament-filename']) ||
        getHeaderValue(req.headers['get5-filename']);
      const atMatchId =
        getHeaderValue(req.headers['auto-tournament-matchid']) ||
        getHeaderValue(req.headers['get5-matchid']);
      const atMapNumber =
        getHeaderValue(req.headers['auto-tournament-mapnumber']) ||
        getHeaderValue(req.headers['get5-mapnumber']);
      const atRoundNumber =
        getHeaderValue(req.headers['auto-tournament-roundnumber']) ||
        getHeaderValue(req.headers['get5-roundnumber']);

      // Validate required headers (per Auto Tournament CS2 API spec)
      if (!atFilename || !atMatchId || atMapNumber === undefined) {
        const missingHeaders: string[] = [];
        if (!atFilename) missingHeaders.push('Auto-Tournament-FileName (or Get5-FileName)');
        if (!atMatchId) missingHeaders.push('Auto-Tournament-MatchId (or Get5-MatchId)');
        if (atMapNumber === undefined)
          missingHeaders.push('Auto-Tournament-MapNumber (or Get5-MapNumber)');

        log.warn('[Demo Upload] Missing required headers', {
          matchSlug,
          missingHeaders,
          received: {
            filename: atFilename || 'missing',
            matchId: atMatchId || 'missing',
            mapNumber: atMapNumber ?? 'missing',
          },
        });

        return res.status(400).json({
          success: false,
          error: 'Missing required headers',
          required: ['Auto-Tournament-FileName', 'Auto-Tournament-MatchId', 'Auto-Tournament-MapNumber'],
          missing: missingHeaders,
        });
      }

      // Validate request body exists and is a Buffer
      if (!req.body || !Buffer.isBuffer(req.body)) {
        log.warn('[Demo Upload] Invalid request body - expected binary data', {
          matchSlug,
          bodyType: typeof req.body,
          isBuffer: Buffer.isBuffer(req.body),
        });

        return res.status(400).json({
          success: false,
          error: 'Invalid request body - expected binary demo file data',
        });
      }

      log.info('[Demo Upload] Upload request received', {
        matchSlug,
        filename: atFilename,
        matchId: atMatchId,
        mapNumber: atMapNumber,
        roundNumber: atRoundNumber,
        fileSize: req.body.length,
        fileSizeMB: (req.body.length / 1024 / 1024).toFixed(2),
        headers: {
          'Auto-Tournament-FileName': atFilename,
          'Auto-Tournament-MatchId': atMatchId,
          'Auto-Tournament-MapNumber': atMapNumber,
          'Auto-Tournament-RoundNumber': atRoundNumber || 'not provided',
        },
      });

      // Which match is this demo from? The URL slug is only the server's current
      // upload setting, which MAT overwrites when it loads the next match - and
      // the previous match's last demo uploads after that (Auto Tournament CS2 waits for
      // tv_delay first). That is how r1m1's de_train demo landed on r2m1. The
      // Auto-Tournament-MatchId header is stamped when the demo was recorded, so when it
      // is one of MAT's numeric ids it decides. An id that no longer exists
      // (the tournament was reset, and the slug now belongs to a new match) is
      // rejected rather than attached to whatever reuses the slug.
      const headerMatchId = demoMatchIdFromHeader(atMatchId);
      let match: DbMatchRow | null | undefined;
      if (headerMatchId !== null) {
        match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
          headerMatchId,
        ]);
        if (!match) {
          log.warn('[Demo Upload] Rejected: demo belongs to a match that no longer exists', {
            urlMatchSlug,
            matchId: atMatchId,
            filename: atFilename,
          });
          return res.status(410).json({
            success: false,
            error: `Match id ${headerMatchId} no longer exists; demo not stored`,
          });
        }
        if (match.slug !== urlMatchSlug) {
          log.warn('[Demo Upload] Upload URL names a different match than the demo; using the demo match id', {
            urlMatchSlug,
            matchId: headerMatchId,
            resolvedMatchSlug: match.slug,
            filename: atFilename,
          });
        }
      } else {
        match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
          urlMatchSlug,
        ]);
      }

      if (!match) {
        log.warn(`Demo upload rejected: Match ${urlMatchSlug} not found`);
        return res.status(404).json({
          success: false,
          error: `Match '${urlMatchSlug}' not found`,
        });
      }
      matchSlug = match.slug;

      // Create match-specific folder (following Auto Tournament CS2 pattern)
      const matchFolder = path.join(DEMOS_DIR, matchSlug);
      if (!fs.existsSync(matchFolder)) {
        fs.mkdirSync(matchFolder, { recursive: true });
      }

      // Use Auto Tournament CS2's filename (sanitize to prevent path traversal)
      const sanitizeFilename = (filename: string): string => {
        // Remove any path separators and resolve to just the filename
        return path.basename(filename);
      };
      const filename = sanitizeFilename(atFilename); // Validated above
      const filepath = path.join(matchFolder, filename);

      // Write binary data to file (req.body is a Buffer from express.raw())
      fs.writeFileSync(filepath, req.body);

      // Verify file was written
      if (!fs.existsSync(filepath)) {
        throw new Error('File was not written to disk');
      }

      const stats = fs.statSync(filepath);
      const fileSize = stats.size;
      const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

      // Update match with demo file path (store relative path)
      const relativePath = path.join(matchSlug, filename);

      // Store demo path in match record (for backward compatibility)
      await db.updateAsync('matches', { demo_file_path: relativePath }, 'slug = ?', [matchSlug]);

      // Also store demo path per map if map number is provided
      const mapNumber = parseInt(atMapNumber, 10);
      if (!isNaN(mapNumber)) {
        try {
          // Update the map result with demo file path
          await db.runAsync(
            `UPDATE match_map_results 
             SET demo_file_path = ? 
             WHERE match_slug = ? AND map_number = ?`,
            [relativePath, matchSlug, mapNumber]
          );
          log.debug('[Demo Upload] Stored demo path for map', {
            matchSlug,
            mapNumber,
            demoPath: relativePath,
          });
        } catch (error) {
          log.warn('[Demo Upload] Failed to store demo path for map', {
            matchSlug,
            mapNumber,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      log.success('[Demo Upload] Demo uploaded successfully', {
        matchSlug,
        filename,
        matchId: atMatchId,
        mapNumber: atMapNumber,
        roundNumber: atRoundNumber,
        path: relativePath,
        fileSize: `${fileSizeMB} MB`,
        fileSizeBytes: fileSize,
        filepath,
      });

      // Emit match update to notify frontend that demo was uploaded
      try {
        const updatedMatch = await db.queryOneAsync<DbMatchRow>(
          'SELECT * FROM matches WHERE slug = ?',
          [matchSlug]
        );
        if (updatedMatch) {
          const mapResults = await getMapResults(matchSlug);
          emitMatchUpdate({
            slug: matchSlug,
            id: updatedMatch.id,
            status: updatedMatch.status,
            mapResults,
          });
          log.debug('[Demo Upload] Emitted match update', { matchSlug });
        }
      } catch (updateError) {
        log.warn('[Demo Upload] Failed to emit match update', {
          matchSlug,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
      }

      // Return success response (per Auto Tournament CS2 API spec - 200-299 status codes are success)
      return res.status(200).json({
        success: true,
        message: 'Demo uploaded successfully',
        matchId: atMatchId,
        mapNumber: parseInt(atMapNumber, 10),
        filename,
        fileSize: fileSize,
        savedPath: relativePath,
      });
    } catch (error) {
      log.error('Error processing demo upload', error, { matchSlug });
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: 'Failed to process demo upload',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
  }
);

/**
 * GET /api/demos/:matchSlug/download/:mapNumber?
 * Download demo file for a match or specific map
 * Public access for completed matches (for team pages), auth required for others
 */
router.get(
  '/:matchSlug/download/:mapNumber?',
  async (req: Request, res: Response, next: NextFunction) => {
    // Allow public access for completed matches (for team pages)
    // Require auth for matches in progress or pending
    try {
      const { matchSlug } = req.params;
      const match = await db.queryOneAsync<DbMatchRow>(
        'SELECT status FROM matches WHERE slug = ?',
        [matchSlug]
      );

      // If match is completed, allow public access
      if (match && match.status === 'completed') {
        // Continue without auth - proceed to handler
        next();
        return;
      }

      // For other statuses, require auth
      requireAuth(req, res, next);
    } catch {
      // On error, require auth as fallback
      requireAuth(req, res, next);
    }
  },
  async (req: Request, res: Response) => {
    try {
      const { matchSlug, mapNumber } = req.params;

      // Get match details
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
        matchSlug,
      ]);

      if (!match) {
        return res.status(404).json({
          success: false,
          error: `Match '${matchSlug}' not found`,
        });
      }

      let demoFilePath: string | null = null;

      // If map number is provided, try to get demo from map result
      if (mapNumber) {
        const mapNum = parseInt(mapNumber, 10);
        if (!isNaN(mapNum)) {
          const mapResult = await db.queryOneAsync<{ demo_file_path?: string | null }>(
            'SELECT demo_file_path FROM match_map_results WHERE match_slug = ? AND map_number = ?',
            [matchSlug, mapNum]
          );
          if (mapResult?.demo_file_path) {
            demoFilePath = mapResult.demo_file_path;
          }
        }
      }

      // Fallback to match-level demo file path
      if (!demoFilePath && match.demo_file_path) {
        demoFilePath = match.demo_file_path;
      }

      if (!demoFilePath) {
        return res.status(404).json({
          success: false,
          error: mapNumber
            ? `No demo file available for map ${mapNumber}`
            : 'No demo file available for this match',
        });
      }

      // Handle both old flat structure and new folder structure
      let filepath = path.join(DEMOS_DIR, demoFilePath);

      // If file doesn't exist and path doesn't include folder, try legacy flat path
      if (!fs.existsSync(filepath) && !demoFilePath.includes(path.sep)) {
        filepath = path.join(DEMOS_DIR, matchSlug, demoFilePath);
      }

      if (!fs.existsSync(filepath)) {
        log.warn(`Demo file not found on disk: ${filepath}`, { matchSlug, mapNumber });
        return res.status(404).json({
          success: false,
          error: 'Demo file not found on disk',
        });
      }

      log.debug(`Serving demo file: ${demoFilePath}`, { matchSlug, mapNumber });

      // Extract just filename for download
      const downloadFilename = path.basename(demoFilePath);

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
  }
);

/**
 * GET /api/demos/:matchSlug/status
 * Get demo upload configuration status for a match
 * Shows if demo upload is configured and expected upload URL
 * Protected by API token
 * 
 * HOW TO VERIFY DEMO UPLOAD IS ENABLED:
 * 1. Check this endpoint: GET /api/demos/:matchSlug/status
 *    - demoUploadConfigured should be true
 *    - expectedUploadUrl should be a valid URL
 * 2. When loading a match, check logs for:
 *    - "DEMO UPLOAD CONFIGURED SUCCESSFULLY"
 *    - Or "DEMO UPLOAD CONFIGURATION FAILED"
 * 3. When a demo is uploaded, you'll see:
 *    - "DEMO UPLOAD RECEIVED"
 *    - "DEMO UPLOAD COMPLETED SUCCESSFULLY"
 * 4. Verify webhook_url is set in Settings (required for demo upload URL)
 */
router.get('/:matchSlug/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT id, slug, server_id, status, demo_file_path FROM matches WHERE slug = ?',
      [matchSlug]
    );

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${matchSlug}' not found`,
      });
    }

    // Get webhook base URL to construct expected upload URL
    const baseUrl = await settingsService.getSetting('webhook_url');

    const expectedUploadUrl = baseUrl ? `${baseUrl}/api/demos/${matchSlug}/upload` : null;

    // Check if demo file exists
    let demoExists = false;
    let demoFileSize = 0;
    if (match.demo_file_path) {
      let filepath = path.join(DEMOS_DIR, match.demo_file_path);
      if (!fs.existsSync(filepath) && !match.demo_file_path.includes(path.sep)) {
        filepath = path.join(DEMOS_DIR, matchSlug, match.demo_file_path);
      }
      if (fs.existsSync(filepath)) {
        demoExists = true;
        const stats = fs.statSync(filepath);
        demoFileSize = stats.size;
      }
    }

    res.json({
      success: true,
      matchSlug,
      matchId: match.id,
      serverId: match.server_id,
      matchStatus: match.status,
      demoUploadConfigured: !!expectedUploadUrl,
      expectedUploadUrl,
      hasDemoFile: demoExists,
      demoFilePath: match.demo_file_path || null,
      demoFileSize: demoExists ? demoFileSize : 0,
      demoFileSizeFormatted: demoExists ? `${(demoFileSize / 1024 / 1024).toFixed(2)} MB` : null,
      note: expectedUploadUrl
        ? 'Auto Tournament CS2 should upload demos to the expected URL after match/map completion'
        : 'Webhook URL not configured - demo uploads will not work',
    });
    return;
  } catch (error) {
    log.error('Error getting demo status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get demo status',
    });
    return;
  }
});

/**
 * GET /api/demos/:matchSlug/info
 * Get demo file info without downloading
 * Protected by API token
 */
router.get('/:matchSlug/info', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT demo_file_path FROM matches WHERE slug = ?',
      [matchSlug]
    );

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
