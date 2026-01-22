import { Router, Request, Response } from 'express';
import { serverService } from '../services/serverService';
import { CreateServerInput, UpdateServerInput } from '../types/server.types';
import { requireAuth } from '../middleware/auth';
import { matchAllocationService } from '../services/matchAllocationService';
import { serverInitializationService } from '../services/serverInitializationService';
import { log } from '../utils/logger';

const router = Router();

// Protect all server routes
router.use(requireAuth);

/**
 * GET /api/servers
 * Get all servers
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const onlyEnabled = req.query.enabled === 'true';
    const servers = await serverService.getAllServers(onlyEnabled);

    return res.json({
      success: true,
      count: servers.length,
      servers,
    });
  } catch (error) {
    console.error('Error fetching servers:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch servers',
    });
  }
});

/**
 * POST /api/servers/batch
 * Create multiple servers at once
 * Query param: ?upsert=true to update if exists instead of error
 * NOTE: This must be before /:id routes to avoid matching "batch" as an ID
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const servers: CreateServerInput[] = req.body;
    const upsert = req.query.upsert === 'true';

    if (!Array.isArray(servers) || servers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a non-empty array of servers',
      });
    }

    const result = await serverService.createServers(servers, upsert);

    return res.status(result.failed.length > 0 ? 207 : 201).json({
      success: result.failed.length === 0,
      message: upsert
        ? `Created/updated ${result.successful.length} server(s), ${result.failed.length} failed`
        : `Created ${result.successful.length} server(s), ${result.failed.length} failed`,
      successful: result.successful,
      failed: result.failed,
      stats: {
        total: servers.length,
        successful: result.successful.length,
        failed: result.failed.length,
      },
    });
  } catch (error) {
    console.error('Error in batch create:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process batch creation',
    });
  }
});

/**
 * PATCH /api/servers/batch
 * Update multiple servers at once
 * NOTE: This must be before /:id routes to avoid matching "batch" as an ID
 */
router.patch('/batch', async (req: Request, res: Response) => {
  try {
    const updates: Array<{ id: string; updates: UpdateServerInput }> = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a non-empty array of update objects',
      });
    }

    // Validate structure
    for (const item of updates) {
      if (!item.id || !item.updates) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have "id" and "updates" properties',
        });
      }
    }

    const result = await serverService.updateServers(updates);

    return res.status(result.failed.length > 0 ? 207 : 200).json({
      success: result.failed.length === 0,
      message: `Updated ${result.successful.length} server(s), ${result.failed.length} failed`,
      successful: result.successful,
      failed: result.failed,
      stats: {
        total: updates.length,
        successful: result.successful.length,
        failed: result.failed.length,
      },
    });
  } catch (error) {
    console.error('Error in batch update:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process batch update',
    });
  }
});

/**
 * GET /api/servers/:id
 * Get a specific server
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await serverService.getServerById(id);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: `Server '${id}' not found`,
      });
    }

    return res.json({
      success: true,
      server,
    });
  } catch (error) {
    console.error('Error fetching server:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch server',
    });
  }
});

/**
 * POST /api/servers
 * Create a new server
 * Query param: ?upsert=true to update if exists instead of error
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateServerInput = req.body;
    const upsert = req.query.upsert === 'true';

    // Validate required fields
    if (!input.id || !input.name || !input.host || !input.port || !input.password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, name, host, port, password',
      });
    }

    const server = await serverService.createServer(input, upsert);

    // If the server is enabled (default is true), trigger immediate allocation
    if (server.enabled !== false) {
      log.info(`New server ${server.id} created and enabled, triggering immediate allocation`);
      setImmediate(() => {
        void matchAllocationService.tryImmediateAllocation();
      });
    }

    return res.status(201).json({
      success: true,
      message: upsert ? 'Server created or updated successfully' : 'Server created successfully',
      server,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create server';
    const statusCode = message.includes('already exists') ? 409 : 400;

    console.error('Error creating server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/servers/:id
 * Update a server
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateServerInput = req.body;

    const server = await serverService.updateServer(id, input);

    // If the update explicitly set enabled to true, trigger allocation
    // (even if it was already true - safe and ensures waiting matches get allocated)
    if (input.enabled === true) {
      log.info(`Server ${id} updated with enabled=true, triggering immediate allocation`);
      setImmediate(() => {
        void matchAllocationService.tryImmediateAllocation();
      });
    }

    return res.json({
      success: true,
      message: 'Server updated successfully',
      server,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update server';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error updating server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PATCH /api/servers/:id
 * Partially update a server
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateServerInput = req.body;

    const server = await serverService.updateServer(id, input);

    // If the update explicitly set enabled to true, trigger allocation
    if (input.enabled === true) {
      log.info(`Server ${id} patched with enabled=true, triggering immediate allocation`);
      setImmediate(() => {
        void matchAllocationService.tryImmediateAllocation();
      });
    }

    return res.json({
      success: true,
      message: 'Server updated successfully',
      server,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update server';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error updating server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/servers/:id
 * Delete a server
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await serverService.deleteServer(id);

    return res.json({
      success: true,
      message: 'Server deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete server';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error deleting server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/servers/bulk-delete
 * Bulk delete servers by ID array
 */
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must include a non-empty ids array',
      });
    }

    let deletedCount = 0;
    let errorCount = 0;
    const errors: { id: string; error: string }[] = [];

    for (const id of ids) {
      try {
        await serverService.deleteServer(id);
        deletedCount += 1;
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : 'Failed to delete server';
        errors.push({ id, error: message });
      }
    }

    const statusCode = errorCount > 0 ? 207 : 200;
    return res.status(statusCode).json({
      success: errorCount === 0,
      deleted: deletedCount,
      failed: errorCount,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to bulk delete servers';
    console.error('Error bulk deleting servers:', error);
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/servers/:id/enable
 * Enable a server
 */
router.post('/:id/enable', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await serverService.setServerEnabled(id, true);

    // Server is now available - trigger immediate allocation for waiting matches
    log.info(`Server ${id} enabled, triggering immediate allocation`);
    setImmediate(() => {
      void matchAllocationService.tryImmediateAllocation();
    });

    return res.json({
      success: true,
      message: 'Server enabled',
      server,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable server';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error enabling server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/servers/:id/disable
 * Disable a server
 */
router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await serverService.setServerEnabled(id, false);

    return res.json({
      success: true,
      message: 'Server disabled',
      server,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to disable server';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error disabling server:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/servers/:id/reset-initialization
 * Reset server initialization status
 * Forces re-sending of persistent configuration on next match load
 * Useful when configuration has changed or server was reconfigured
 */
router.post('/:id/reset-initialization', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Verify server exists
    const server = await serverService.getServerById(id);
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found',
      });
    }

    await serverInitializationService.resetServerInitialization(id);

    return res.json({
      success: true,
      message: `Server ${id} initialization reset. Persistent configuration will be resent on next match load.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset server initialization';
    console.error('Error resetting server initialization:', error);
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/servers/reset-all-initialization
 * Reset initialization status for ALL servers
 * Useful after global configuration changes
 */
router.post('/reset-all-initialization', async (req: Request, res: Response) => {
  try {
    await serverInitializationService.resetAllServers();

    return res.json({
      success: true,
      message: 'All servers initialization reset. Persistent configuration will be resent on next match loads.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset all servers initialization';
    console.error('Error resetting all servers initialization:', error);
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
