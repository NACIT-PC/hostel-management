# Hostel Bed Allocation System

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Mobile](https://img.shields.io/badge/Mobile-Phone_&_Tablet-000000?style=for-the-badge&logo=android&logoColor=white)](https://simpleicons.org/)
[![Web](https://img.shields.io/badge/Web-Laptop_&_Desktop-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://simpleicons.org/)

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

> TODO: Add entity relationship diagram.

### 2.2 Use Case Diagram

Shows how each user relates to their roles / functional requirements.

> TODO: Add use case diagram.

### 2.3 Class Diagram

Keeps information and shows data types.

> TODO: Add class diagram.
