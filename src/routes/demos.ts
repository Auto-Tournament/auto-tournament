import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateServerToken } from '../middleware/serverAuth';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { settingsService } from '../services/settingsService';
import { emitMatchUpdate } from '../services/socketService';
import { getMapResults } from '../services/matchMapResultService';
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
router.post('/:matchSlug/upload', validateServerToken, async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    // Read MatchZy headers
    const matchzyFilename = req.header('MatchZy-FileName');
    const matchzyMatchId = req.header('MatchZy-MatchId');
    const matchzyMapNumber = req.header('MatchZy-MapNumber');

    // ========================================
    // 🎬 DEMO UPLOAD RECEIVED - HUGE LOG BLOCK
    // ========================================
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('🎬🎬🎬  DEMO UPLOAD RECEIVED FROM MATCHZY  🎬🎬🎬');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`📦 Match Slug:     ${matchSlug}`);
    console.log(`📄 Filename:       ${matchzyFilename || 'NOT PROVIDED'}`);
    console.log(`🆔 Match ID:        ${matchzyMatchId || 'NOT PROVIDED'}`);
    console.log(`🗺️  Map Number:     ${matchzyMapNumber || 'NOT PROVIDED'}`);
    console.log(`⏰ Timestamp:       ${new Date().toISOString()}`);
    console.log(`📊 Content-Length:  ${req.headers['content-length'] || 'unknown'} bytes`);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('\n');

    log.info('[Demo Upload] Upload request received', {
      matchSlug,
      filename: matchzyFilename,
      matchId: matchzyMatchId,
      mapNumber: matchzyMapNumber,
      headers: {
        'MatchZy-FileName': matchzyFilename || 'not provided',
        'MatchZy-MatchId': matchzyMatchId || 'not provided',
        'MatchZy-MapNumber': matchzyMapNumber || 'not provided',
      },
    });

    // Get match details
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      matchSlug,
    ]);

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
    req.on('end', async () => {
      writeStream.end();

      // Update match with demo file path (store relative path)
      const relativePath = path.join(matchSlug, filename);

      // Store demo path in match record (for backward compatibility)
      await db.updateAsync('matches', { demo_file_path: relativePath }, 'slug = ?', [matchSlug]);

      // Also store demo path per map if map number is provided
      if (matchzyMapNumber) {
        const mapNumber = parseInt(matchzyMapNumber, 10);
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
      }

      // Verify file was written
      let fileSize = 0;
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        fileSize = stats.size;
      }

      const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

      // ========================================
      // ✅ DEMO UPLOAD SUCCESS - HUGE LOG BLOCK
      // ========================================
      console.log('\n');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('✅✅✅  DEMO UPLOAD COMPLETED SUCCESSFULLY  ✅✅✅');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`📦 Match Slug:     ${matchSlug}`);
      console.log(`📄 Filename:       ${filename}`);
      console.log(`🆔 Match ID:        ${matchzyMatchId || 'N/A'}`);
      console.log(`🗺️  Map Number:     ${matchzyMapNumber || 'N/A'}`);
      console.log(`💾 File Size:       ${fileSizeMB} MB (${fileSize.toLocaleString()} bytes)`);
      console.log(`📁 Relative Path:   ${relativePath}`);
      console.log(`💿 Full Path:       ${filepath}`);
      console.log(`⏰ Completed At:     ${new Date().toISOString()}`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('\n');

      log.success('[Demo Upload] Demo uploaded successfully', {
        matchSlug,
        filename,
        matchId: matchzyMatchId,
        mapNumber: matchzyMapNumber,
        path: relativePath,
        fileSize: `${fileSizeMB} MB`,
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

      res.status(200).json({
        success: true,
        message: 'Demo uploaded successfully',
        filename,
      });
    });

    // If there is a problem writing the file, reply with 500
    writeStream.on('error', (err) => {
      console.log('\n');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('❌❌❌  DEMO UPLOAD FAILED - FILE WRITE ERROR  ❌❌❌');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`📦 Match Slug:     ${matchSlug}`);
      console.log(`📄 Filename:       ${matchzyFilename || 'N/A'}`);
      console.log(`❌ Error:           ${err.message}`);
      console.log(`💿 File Path:      ${filepath}`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('\n');
      log.error('Error writing demo file', err);
      res.status(500).json({
        success: false,
        error: 'Error writing demo file: ' + err.message,
      });
    });

    // Handle request errors
    req.on('error', (error) => {
      console.log('\n');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('❌❌❌  DEMO UPLOAD FAILED - REQUEST ERROR  ❌❌❌');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`📦 Match Slug:     ${matchSlug}`);
      console.log(`❌ Error:           ${error instanceof Error ? error.message : String(error)}`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('\n');
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
 *    - "✅✅✅  DEMO UPLOAD CONFIGURED SUCCESSFULLY  ✅✅✅"
 *    - Or "❌❌❌  DEMO UPLOAD CONFIGURATION FAILED  ❌❌❌"
 * 3. When a demo is uploaded, you'll see:
 *    - "🎬🎬🎬  DEMO UPLOAD RECEIVED FROM MATCHZY  🎬🎬🎬"
 *    - "✅✅✅  DEMO UPLOAD COMPLETED SUCCESSFULLY  ✅✅✅"
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
        ? 'MatchZy should upload demos to the expected URL after match/map completion'
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
