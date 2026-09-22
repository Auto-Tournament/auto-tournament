/**
 * @openapi
 * /api/servers:
 *   get:
 *     tags:
 *       - Servers
 *     summary: List all servers
 *     description: Get all servers or filter by enabled status
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: Filter by enabled servers only
 *     responses:
 *       200:
 *         description: List of servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 servers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Server'
 */

/**
 * @openapi
 * /api/servers:
 *   post:
 *     tags:
 *       - Servers
 *     summary: Create a new server
 *     description: Create a new server configuration
 *     parameters:
 *       - in: query
 *         name: upsert
 *         schema:
 *           type: boolean
 *         description: If true, update the server if it already exists
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateServerInput'
 *     responses:
 *       201:
 *         description: Server created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 server:
 *                   $ref: '#/components/schemas/Server'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Server already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @openapi
 * /api/servers/batch:
 *   post:
 *     tags:
 *       - Servers
 *     summary: Create multiple servers
 *     description: Batch create servers. Use ?upsert=true to update existing servers.
 *     parameters:
 *       - in: query
 *         name: upsert
 *         schema:
 *           type: boolean
 *         description: If true, update servers if they already exist
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/CreateServerInput'
 *     responses:
 *       201:
 *         description: Servers created successfully
 *       207:
 *         description: Partial success (some servers failed)
 */

/**
 * @openapi
 * /api/servers/{id}:
 *   get:
 *     tags:
 *       - Servers
 *     summary: Get server by ID
 *     description: Retrieve a specific server configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Server ID
 *     responses:
 *       200:
 *         description: Server found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 server:
 *                   $ref: '#/components/schemas/Server'
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @openapi
 * /api/servers/{id}:
 *   patch:
 *     tags:
 *       - Servers
 *     summary: Update server (partial)
 *     description: Partially update a server configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateServerInput'
 *     responses:
 *       200:
 *         description: Server updated
 *       404:
 *         description: Server not found
 */

/**
 * @openapi
 * /api/servers/{id}:
 *   delete:
 *     tags:
 *       - Servers
 *     summary: Delete server
 *     description: Remove a server configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Server deleted
 *       404:
 *         description: Server not found
 */

/**
 * @openapi
 * /api/servers/{id}/enable:
 *   post:
 *     tags:
 *       - Servers
 *     summary: Enable server
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Server enabled
 */

/**
 * @openapi
 * /api/servers/{id}/disable:
 *   post:
 *     tags:
 *       - Servers
 *     summary: Disable server
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Server disabled
 */
