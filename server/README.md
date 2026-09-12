# Kaizen Todo — Spring Boot Server

Java 17 + Spring Boot 3.3 backend for the Kaizen Todo App.  
Runs alongside the existing React + Vite frontend without replacing it.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Java 17 |
| Framework | Spring Boot 3.3 |
| Persistence | Spring Data JPA + H2 (in-memory) |
| Validation | Jakarta Bean Validation |
| Boilerplate | Lombok |
| Build | Maven (spring-boot-maven-plugin) |

---

## Running the server

```bash
cd server
./mvnw spring-boot:run
# or: mvn spring-boot:run
```

Server starts on **http://localhost:8080**.  
H2 console: **http://localhost:8080/h2-console** (JDBC URL: `jdbc:h2:mem:kaizendb`, user: `sa`, no password).

The Vite dev server runs on port 5173 — CORS is pre-configured for both ports.

---

## REST API

All endpoints are under `/api/tasks`.

### List tasks

```
GET /api/tasks
GET /api/tasks?status=TODO          # filter by status
GET /api/tasks?status=IN_PROGRESS
GET /api/tasks?status=DONE
GET /api/tasks?quadrant=DO          # filter by Eisenhower quadrant
GET /api/tasks?quadrant=SCHEDULE
GET /api/tasks?quadrant=DELEGATE
GET /api/tasks?quadrant=ELIMINATE
```

### Today's completed tasks (for Today's History panel)

```
GET /api/tasks/today-completed
```

Returns all tasks with `completedAt` falling on today's UTC date.  
Each response includes `"completedToday": true` for convenience.

### Get single task

```
GET /api/tasks/{id}
```

### Create task

```
POST /api/tasks
Content-Type: application/json

{
  "title": "Write unit tests",          // required
  "status": "TODO",                     // optional, default: TODO
  "quadrant": "DO",                     // optional, default: DO
  "priority": "HIGH",                   // optional: LOW | MEDIUM | HIGH
  "note": "Cover edge cases",           // optional
  "dueDate": "2024-09-01",             // optional, ISO date
  "dueTime": "17:00",                   // optional, HH:MM
  "category": "Engineering"             // optional
}
```

### Update status

```
PATCH /api/tasks/{id}/status
Content-Type: application/json

{ "status": "IN_PROGRESS" }
```

Automatically sets `completedAt` when transitioning to `DONE`,  
and clears it when transitioning away from `DONE`.

### Mark complete

```
PATCH /api/tasks/{id}/complete
```

Sets `status = DONE` and `completedAt = now()`. Idempotent.

### Full update

```
PUT /api/tasks/{id}
Content-Type: application/json

{ ...same shape as POST... }
```

### Delete task

```
DELETE /api/tasks/{id}
```

---

## Data model

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Auto-generated |
| `title` | String (≤500) | Required |
| `status` | Enum | `TODO` \| `IN_PROGRESS` \| `DONE` |
| `quadrant` | Enum | `DO` \| `SCHEDULE` \| `DELEGATE` \| `ELIMINATE` |
| `priority` | Enum | `LOW` \| `MEDIUM` \| `HIGH` (nullable) |
| `note` | String (≤2000) | Nullable |
| `dueDate` | LocalDate | Nullable, ISO-8601 |
| `dueTime` | String HH:MM | Nullable |
| `category` | String (≤100) | Nullable |
| `completedAt` | Instant | Set when status → DONE |
| `createdAt` | Instant | Set on insert |
| `updatedAt` | Instant | Refreshed on every update |

Response objects also include a computed `completedToday: boolean`.

---

## Seed data

10 sample tasks are loaded from `src/main/resources/data.sql` on every startup:

- 4 × **DONE** (3 completed today, 1 completed yesterday)
- 2 × **IN_PROGRESS**
- 4 × **TODO**

Covers all four quadrants, all three priorities, and a mix of categories  
(`Work`, `Engineering`, `Design`, `Management`, `Personal`, `Admin`).

---

## Wiring to the frontend

To replace localStorage persistence, update the frontend service layer to call these endpoints instead of reading/writing `localStorage`. The response shape maps directly to the existing `Todo` TypeScript interface:

| Backend field | Frontend field |
|---|---|
| `id` | `id` |
| `title` | `text` |
| `status` | `status` (map `DONE` → `completed: true`) |
| `quadrant` | `quadrant` |
| `priority` | `priority` |
| `note` | `note` |
| `dueDate` | `dueDate` |
| `completedAt` | `completedAt` (ISO string → `Date.parse()` for epoch ms) |
| `createdAt` | `createdAt` |
| `completedToday` | used by `TodayHistoryPanel` filter |

---

## Project structure

```
server/
├── pom.xml
└── src/main/
    ├── java/com/kaizen/todo/
    │   ├── KaizenTodoApplication.java      # Entry point
    │   ├── controller/
    │   │   ├── TaskController.java         # REST endpoints
    │   │   └── GlobalExceptionHandler.java # Unified error responses
    │   ├── dto/
    │   │   ├── TaskRequest.java            # Validated inbound DTO
    │   │   └── TaskResponse.java           # Outbound DTO (+ completedToday)
    │   ├── model/
    │   │   ├── Task.java                   # JPA entity
    │   │   ├── TaskStatus.java             # TODO | IN_PROGRESS | DONE
    │   │   ├── Quadrant.java               # DO | SCHEDULE | DELEGATE | ELIMINATE
    │   │   └── Priority.java               # LOW | MEDIUM | HIGH
    │   ├── repository/
    │   │   └── TaskRepository.java         # JPA queries
    │   └── service/
    │       └── TaskService.java            # Business logic
    └── resources/
        ├── application.properties          # H2 + JPA config
        └── data.sql                        # 10 seed tasks
```
