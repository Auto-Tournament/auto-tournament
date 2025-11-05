/**
 * @openapi
 * /api/rcon/test:
 *   get:
 *     tags:
 *       - RCON
 *     summary: Test all RCON connections
 *     description: Test RCON connectivity to all enabled servers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test results
 *       401:
 *         description: Unauthorized
 */

/**
 * @openapi
 * /api/rcon/test/{serverId}:
 *   get:
 *     tags:
 *       - RCON
 *     summary: Test RCON connection to specific server
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Connection successful
 *       400:
 *         description: Connection failed
 */

/**
 * @openapi
 * /api/rcon/practice-mode:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Start practice mode
 *     description: Execute css_prac command on server
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *                 example: cs1
 *     responses:
 *       200:
 *         description: Command executed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RconResponse'
 *       401:
 *         description: Unauthorized
 */

/**
 * @openapi
 * /api/rcon/start-match:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Force start match
 *     description: Execute css_start command on server
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *                 example: cs1
 *     responses:
 *       200:
 *         description: Match started
 */

/**
 * @openapi
 * /api/rcon/change-map:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Change map
 *     description: Execute css_map command on server
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *               - mapName
 *             properties:
 *               serverId:
 *                 type: string
 *                 example: cs1
 *               mapName:
 *                 type: string
 *                 example: de_dust2
 *                 description: Map name (alphanumeric, underscores, hyphens only)
 *     responses:
 *       200:
 *         description: Map changed
 *       400:
 *         description: Invalid map name
 */

/**
 * @openapi
 * /api/rcon/pause-match:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Pause match
 *     description: Execute css_pause command
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Match paused
 */

/**
 * @openapi
 * /api/rcon/unpause-match:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Unpause match
 *     description: Execute css_unpause command
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Match unpaused
 */

/**
 * @openapi
 * /api/rcon/restart-match:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Restart match
 *     description: Execute mp_restartgame command (restarts current round)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Match restarted
 */

/**
 * @openapi
 * /api/rcon/end-warmup:
 *   post:
 *     tags:
 *       - RCON
 *     summary: End warmup
 *     description: Execute mp_warmup_end command
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Warmup ended
 */

/**
 * @openapi
 * /api/rcon/reload-admins:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Reload admins
 *     description: Execute css_reload_admins command
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *             properties:
 *               serverId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Admins reloaded
 */

/**
 * @openapi
 * /api/rcon/say:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Send message to server
 *     description: Send a chat message to a specific server (sanitized, max 200 chars)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serverId
 *               - message
 *             properties:
 *               serverId:
 *                 type: string
 *                 example: cs1
 *               message:
 *                 type: string
 *                 example: Welcome to NTLAN 2025!
 *                 maxLength: 200
 *     responses:
 *       200:
 *         description: Message sent
 */

/**
 * @openapi
 * /api/rcon/broadcast:
 *   post:
 *     tags:
 *       - RCON
 *     summary: Broadcast message
 *     description: Send a message to all servers or specific servers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 example: Server maintenance in 10 minutes!
 *                 maxLength: 200
 *               serverIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["cs1", "cs2", "cs3"]
 *                 description: Optional list of server IDs. If omitted, broadcasts to all enabled servers.
 *     responses:
 *       200:
 *         description: Broadcast successful
 *       207:
 *         description: Partial success
 */
