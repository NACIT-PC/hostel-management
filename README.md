# Hostel Bed Allocation System

Design documentation for a system to manage bed allocation in a hostel.

## 1. System Requirements

### 1.1 Technical Requirements

**a. Languages / Stack**

- JavaScript
- Supabase / SQLite

> Flexible as it allows cross-platform support.

**b. Database Type**

- **Relational database** — allows answering documentational queries, e.g.:
  - Which student belongs to which room?
  - Number of students per room / hostel / etc.

**c. Supported Devices**

- Phones
- Laptops

### 1.2 User Requirements

a. **Fee registration** — at least first deposit required
b. **Student ID** — identity of payer, name, gender
c. **Hostel inventory** — names of hostels, number of rooms in each hostel, and number of beds
d. **Hostel categorization** — which hostels are male or female, for what year / form, or whatever separates them accordingly

### 1.3 Functional Requirements

a. Registering a student
b. Registering the hostels
c. Checking in
d. Checking out
e. Finding out availability
f. Assessing eligibility — whether students have paid
g. Assigning students to rooms — taking into consideration health and sensitivity issues

### 1.4 Legal & Ethical Requirements

- Keeping track of health conditions with privacy
- Protect data against unauthorized access (authentication)

## 2. Design Diagrams

### 2.1 ERD — Entity Relationship Diagram

Source of truth: `src/db/schema.sql` (SQLite). Amounts are printed in `MWK`
via `settings.currency`. `allocations` allows only one active
(`assigned`, `checked_in`) row per student and per bed (partial unique indexes).

![ERD](docs/diagrams/erd.png)

```mermaid
erDiagram
    users ||--o{ hostels : "creates"
    users ||--o{ students : "registers"
    users ||--o{ allocations : "assigns"
    users ||--o{ stay_logs : "records"
    users ||--o{ audit_log : "audited_as"
    users ||--o{ student_health_conditions : "records"
    users ||--o{ fee_payments : "records"
    hostels ||--|{ rooms : "contains"
    rooms ||--|{ beds : "contains"
    students ||--o{ student_health_conditions : "has"
    students ||--o{ fee_payments : "pays"
    students ||--o{ allocations : "holds"
    beds ||--o{ allocations : "occupied_by"
    allocations ||--o{ stay_logs : "moves_through"
    students ||--o{ stay_logs : "moves"
    beds ||--o{ stay_logs : "used_in"

    users {
        int id PK
        string username UK
        string full_name
        string student_id "nullable, recorded at sign up"
        string password_hash
        string role "admin|warden|clerk"
        int active "0|1"
        string last_login_at "datetime, nullable"
        string created_at "datetime"
        string updated_at "datetime"
    }
    settings {
        string key PK "'institution_name','first_deposit_amount','currency'"
        string value "'NACIT Institute','50000','MWK'"
        string label "nullable"
        string updated_at "datetime"
    }
    hostels {
        int id PK
        string name UK
        string gender "Male|Female|Mixed"
        string category "'ALL'|Year|Form"
        int total_rooms
        int total_beds
        string description "nullable"
        int created_by FK "nullable -> users.id"
        string created_at "datetime"
        string updated_at "datetime"
    }
    rooms {
        int id PK
        int hostel_id FK "-> hostels.id"
        string room_number
        int floor "0 = ground"
        int capacity
        string amenities "csv ROOM_AMENITIES"
        int is_available "0|1"
        string created_at "datetime"
    }
    beds {
        int id PK
        int room_id FK "-> rooms.id"
        string label
        string bunk_level "LOWER|UPPER|SINGLE"
        int is_available "0|1"
        string created_at "datetime"
    }
    students {
        int id PK
        string student_code UK
        string full_name
        string gender "Male|Female"
        string year_form
        string phone "nullable"
        string email "nullable"
        string health_notes "private, nullable"
        int is_active "0|1"
        int created_by FK "nullable -> users.id"
        string created_at "datetime"
        string updated_at "datetime"
    }
    student_health_conditions {
        int id PK
        int student_id FK "-> students.id"
        string code "HEALTH_REQUIREMENT_CODES"
        string level "required|preferred"
        string notes "private, nullable"
        int recorded_by FK "nullable -> users.id"
        string created_at "datetime"
    }
    fee_payments {
        int id PK
        int student_id FK "-> students.id"
        float amount "MWK, > 0"
        string fee_type "first_deposit|balance|other"
        string method "Cash|Bank|Mobile money|Cheque|Other"
        string reference "nullable"
        string paid_on "date"
        string note "nullable"
        int recorded_by FK "nullable -> users.id"
        string created_at "datetime"
    }
    allocations {
        int id PK
        int student_id FK "-> students.id"
        int bed_id FK "-> beds.id"
        string status "assigned|checked_in|checked_out|cancelled"
        int assigned_by FK "nullable -> users.id"
        string assigned_at "datetime"
        string checked_in_at "nullable datetime"
        string checked_out_at "nullable datetime"
        string cancelled_at "nullable datetime"
        string notes "nullable"
        string created_at "datetime"
    }
    stay_logs {
        int id PK
        int allocation_id FK "-> allocations.id"
        int student_id FK "-> students.id"
        int bed_id FK "-> beds.id"
        string action "checked_in|checked_out|cancelled"
        int actor_id FK "nullable -> users.id"
        string note "nullable"
        string at "datetime"
    }
    audit_log {
        int id PK
        int user_id FK "nullable -> users.id"
        string username "nullable"
        string action
        string entity "nullable"
        int entity_id "nullable"
        string detail "nullable"
        string at "datetime"
    }
```

### 2.2 Use Case Diagram

Shows how each user relates to their roles / functional requirements.
Roles and permissions: `src/security/roles.js`, `src/security/permissions.js`.
Functional requirements: §1.3 a–g. Dashed arrows are `<<include>>` dependencies.

![Use Case Diagram](docs/diagrams/use-case-diagram.png)

> Source: `docs/diagrams/use-case-diagram.svg`, generated by
> `docs/diagrams/make_use_case.py` (classic UML style: actors outside the
> system boundary, `<<include>>` dashes between use cases).

| Actor | Use cases |
| --- | --- |
| Administrator | UC1–UC11 (all) |
| Warden | UC1–UC9 (no user/role or settings management) |
| Front desk (clerk) | UC1, UC3–UC8 (students, fees, allocation, stay, reports) |

Dependencies: UC4 includes UC3 · UC5 includes UC4, UC9 · UC6 includes UC4.

Self-service sign-up (`src/cli/session.js`) requires a Student ID, recorded on
`users.student_id` — covered by UC10.

### 2.3 Class Diagram

Keeps information and shows data types. Entity attributes mirror
`src/db/schema.sql` column types; service operations mirror `src/services/*.js`.
Money amounts are `REAL` in storage and formatted as `MWK` via `settings.currency`.

![Class Diagram](docs/diagrams/class-diagram.png)

```mermaid
classDiagram
    class User {
        +int id
        +string username
        +string fullName
        +string studentId
        +string passwordHash
        +string role
        +int active
        +string lastLoginAt
        +authenticate(username, password) User
        +createUser(data) User
        +updateUserRole(id, role) User
    }
    class Setting {
        +string key
        +string value
        +string label
        +getCurrency() string
        +getFirstDepositRequirement() float
        +setSetting(key, value) Setting
    }
    class Hostel {
        +int id
        +string name
        +string gender
        +string category
        +int totalRooms
        +int totalBeds
        +createHostel(data) Hostel
        +hostelRuleText(hostel) string
    }
    class Room {
        +int id
        +int hostelId
        +string roomNumber
        +int floor
        +int capacity
        +string amenities
        +int isAvailable
        +addRoom(data) Room
        +setRoomAvailability(id, open) Room
    }
    class Bed {
        +int id
        +int roomId
        +string label
        +string bunkLevel
        +int isAvailable
        +addBed(data) Bed
        +setBedAvailability(id, enabled) Bed
    }
    class Student {
        +int id
        +string studentCode
        +string fullName
        +string gender
        +string yearForm
        +string phone
        +string email
        +string healthNotes
        +int isActive
        +registerStudent(data) Student
        +updateStudent(id, changes) Student
    }
    class HealthCondition {
        +int id
        +int studentId
        +string code
        +string level
        +string notes
        +addHealthCondition(data) HealthCondition
        +getHealthProfile(id, reveal) HealthProfile
    }
    class FeePayment {
        +int id
        +int studentId
        +float amount
        +string feeType
        +string method
        +string reference
        +string paidOn
        +recordPayment(data) FeeSummary
        +getFeeSummary(studentId) FeeSummary
    }
    class Allocation {
        +int id
        +int studentId
        +int bedId
        +string status
        +int assignedBy
        +string assignedAt
        +string checkedInAt
        +string checkedOutAt
        +autoAllocate(studentId, hostelId) Allocation
        +allocateToBed(studentId, bedId) Allocation
        +cancelAllocation(id) void
    }
    class StayLog {
        +int id
        +int allocationId
        +int studentId
        +int bedId
        +string action
        +int actorId
        +checkIn(studentId) Allocation
        +checkOut(studentId) Allocation
    }
    class AuditEntry {
        +int id
        +int userId
        +string username
        +string action
        +string entity
        +int entityId
        +log(event) void
        +listAuditLog(filter) AuditEntry
    }

    User "1" --> "*" Hostel : creates
    User "1" --> "*" Student : registers
    User "1" --> "*" Allocation : assigns
    User "1" --> "*" StayLog : records
    User "1" --> "*" AuditEntry : audited as
    Hostel "1" --> "*" Room : contains
    Room "1" --> "*" Bed : contains
    Student "1" --> "*" HealthCondition : has
    Student "1" --> "*" FeePayment : pays
    Student "1" --> "*" Allocation : holds
    Bed "1" --> "*" Allocation : occupied by
    Allocation "1" --> "*" StayLog : moves through
    Setting "1" --> "*" FeePayment : thresholds
```

## 3. Contributors

| Role | Name | Email |
| ------ | ------ | ------- |
| Owner | Success | <successmwita22@gmail.com> |
| Contributor | AQUA SLOVIC | <aquaslovic@gmail.com> |
| Contributor | Muzika | <muzikamigochi129@gmail.com> |
| Contributor | Bleggo 7 | <bleggobandz@gmail.com> |
| Contributor | dnlmgwi | <pdmgawi@gmail.com> |

## 4. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
