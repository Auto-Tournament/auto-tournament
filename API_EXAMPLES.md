# API Usage Examples

## Server CRUD Operations

### 1. Create a Server

```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "server1",
    "name": "Main CS2 Server",
    "host": "192.168.1.10",
    "port": 27015,
    "password": "rcon_password_here"
  }'
```

### 2. Get All Servers

```bash
curl http://localhost:3000/api/servers
```

### 3. Get Only Enabled Servers

```bash
curl "http://localhost:3000/api/servers?enabled=true"
```

### 4. Get Single Server

```bash
curl http://localhost:3000/api/servers/server1
```

### 5. Update Server (Full)

```bash
curl -X PUT http://localhost:3000/api/servers/server1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Server Name",
    "host": "192.168.1.20",
    "port": 27015,
    "password": "new_password"
  }'
```

### 6. Update Server (Partial)

```bash
curl -X PATCH http://localhost:3000/api/servers/server1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Name Only"
  }'
```

### 7. Disable a Server

```bash
curl -X POST http://localhost:3000/api/servers/server1/disable
```

### 8. Enable a Server

```bash
curl -X POST http://localhost:3000/api/servers/server1/enable
```

### 9. Delete a Server

```bash
curl -X DELETE http://localhost:3000/api/servers/server1
```

### 10. Create or Update Server (Upsert)

If you want to create a server but update it if it already exists, use the `?upsert=true` query parameter:

```bash
curl -X POST "http://localhost:3000/api/servers?upsert=true" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "server1",
    "name": "Main CS2 Server",
    "host": "192.168.1.10",
    "port": 27015,
    "password": "rcon_password_here"
  }'
```

**Behavior:**

- If `server1` doesn't exist → Creates it
- If `server1` exists → Updates it with new values

## Batch Operations

### 11. Create Multiple Servers at Once

```bash
curl -X POST http://localhost:3000/api/servers/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "server1",
      "name": "Server 1",
      "host": "192.168.1.10",
      "port": 27015,
      "password": "pass1"
    },
    {
      "id": "server2",
      "name": "Server 2",
      "host": "192.168.1.11",
      "port": 27015,
      "password": "pass2"
    },
    {
      "id": "server3",
      "name": "Server 3",
      "host": "192.168.1.12",
      "port": 27015,
      "password": "pass3"
    }
  ]'
```

**Response:**

```json
{
  "success": true,
  "message": "Created 3 server(s), 0 failed",
  "successful": [
    {
      "id": "server1",
      "name": "Server 1",
      "host": "192.168.1.10",
      "port": 27015,
      "enabled": true,
      "created_at": 1699000000,
      "updated_at": 1699000000
    }
  ],
  "failed": [],
  "stats": {
    "total": 3,
    "successful": 3,
    "failed": 0
  }
}
```

### 12. Batch Create with Upsert

You can also use upsert mode with batch operations:

```bash
curl -X POST "http://localhost:3000/api/servers/batch?upsert=true" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "server1",
      "name": "Server 1",
      "host": "192.168.1.10",
      "port": 27015,
      "password": "pass1"
    },
    {
      "id": "server2",
      "name": "Server 2",
      "host": "192.168.1.11",
      "port": 27015,
      "password": "pass2"
    }
  ]'
```

This will create new servers or update existing ones with matching IDs.

### 13. Update Multiple Servers at Once

```bash
curl -X PATCH http://localhost:3000/api/servers/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "server1",
      "updates": {
        "name": "Updated Server 1"
      }
    },
    {
      "id": "server2",
      "updates": {
        "port": 27016,
        "host": "192.168.1.20"
      }
    }
  ]'
```

**Response (207 Multi-Status if some fail):**

```json
{
  "success": true,
  "message": "Updated 2 server(s), 0 failed",
  "successful": [
    {
      "id": "server1",
      "name": "Updated Server 1",
      "host": "192.168.1.10",
      "port": 27015,
      "enabled": true,
      "created_at": 1699000000,
      "updated_at": 1699001000
    }
  ],
  "failed": [],
  "stats": {
    "total": 2,
    "successful": 2,
    "failed": 0
  }
}
```

## Using the Database Class

The `DatabaseManager` class provides easy methods for database operations:

```typescript
import { db } from './config/database';

// Get all records
const servers = db.getAll<Server>('servers');

// Get with condition
const enabledServers = db.getAll<Server>('servers', 'enabled = ?', [1]);

// Get single record
const server = db.getOne<Server>('servers', 'id = ?', ['server1']);

// Insert
db.insert('servers', {
  id: 'server1',
  name: 'Test Server',
  host: 'localhost',
  port: 27015,
  password: 'test',
  enabled: 1,
});

// Update
db.update('servers', { name: 'New Name' }, 'id = ?', ['server1']);

// Delete
db.delete('servers', 'id = ?', ['server1']);

// Custom query
const results = db.query<Server>('SELECT * FROM servers WHERE port = ?', [27015]);

// Custom single result
const result = db.queryOne<Server>('SELECT * FROM servers LIMIT 1');
```

## Response Format

### Success Response

```json
{
  "success": true,
  "server": {
    "id": "server1",
    "name": "Main CS2 Server",
    "host": "192.168.1.10",
    "port": 27015,
    "enabled": true,
    "created_at": 1699000000,
    "updated_at": 1699000000
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Server 'server1' not found"
}
```

## Notes

- **Password Security**: Passwords are stored in the database but NOT returned in GET responses
- **Timestamps**: Unix timestamps in seconds
- **Enabled**: Boolean converted to/from SQLite integer (0/1)
- **Validation**: Port numbers must be between 1 and 65535
