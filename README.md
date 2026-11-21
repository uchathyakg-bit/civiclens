
# CivicLens
### AI-Assisted Citizen Complaint Triage & Municipal Response Platform

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Open%20CivicLens-16a34a)](https://civiclens-hm8f.onrender.com)
[![GitHub](https://img.shields.io/badge/Source-GitHub-181717?logo=github)](https://github.com/uchathyakg-bit/civiclens)

**Live Website:** https://civiclens-hm8f.onrender.com

**GitHub Repository:** https://github.com/uchathyakg-bit/civiclens

> CivicLens transforms unstructured citizen complaints into structured, prioritised and department-routed service tickets, helping municipal teams understand, coordinate and track civic issues.

---

## 1. Problem Statement

Citizens frequently encounter civic issues such as damaged roads, overflowing garbage, water leakage, drainage problems and faulty streetlights.

However, reporting these issues often involves:
- Unstructured complaints.
- Language barriers.
- Incomplete location information.
- Difficulty identifying the responsible department.
- Lack of transparent complaint tracking.
- Delayed responses to urgent problems.

CivicLens addresses these challenges through an AI-assisted complaint triage and municipal coordination platform.

## 2. Our Solution

CivicLens provides a unified platform connecting citizens and municipal officers.

Citizens can submit complaints using text, voice input, photographs and geographical locations.

The system processes complaints, identifies their category and severity, recommends the responsible department and creates structured tickets.

Municipal officers can manage complaints through a centralised dashboard with priority sorting, maps, SLA monitoring and operational analytics.

**Our objective:** Make civic complaints easier to report, understand, prioritise and resolve.

## 3. How CivicLens Works

1. **Complaint Submission:** Citizens submit complaints through text, voice or photographs.
2. **AI-Assisted Triage:** The configured triage engine identifies the issue category, severity and relevant department.
3. **Priority Assessment:** Complaints receive priority based on severity, repeat reports, vulnerable locations and SLA timelines.
4. **Department Routing:** Tickets are assigned or routed to the appropriate department.
5. **Operational Management:** Officers manage tickets, update statuses and coordinate field crews.
6. **Citizen Tracking:** Citizens track complaint progress using their unique ticket ID.

## 4. Core Features

| Feature | Implementation |
|---|---|
| Multilingual Reporting | English, Kannada, Hindi, Tamil and Telugu |
| Voice Input | Browser-based speech recognition |
| Photo Upload | Optional complaint photographs |
| AI Classification | Categorisation of civic complaints |
| Severity Detection | Low, Medium, High and Critical |
| Department Routing | Eight configured departments |
| Priority Dashboard | Priority-based complaint management |
| Location Mapping | GPS, map search and draggable pins |
| Duplicate Detection | Identification and merging of repeat reports |
| SLA Monitoring | Response deadlines and overdue alerts |
| Citizen Tracking | Unique ticket IDs and status timelines |
| Officer Dashboard | Complaint management and analytics |

## 5. Additional Features & Innovation

### Intelligent Complaint Management
- Duplicate complaint merging.
- Crowd-based severity escalation.
- Automatic priority calculation.
- Missing-information detection.
- Department reassignment with activity history.

### Geolocation & Mapping
- Interactive location picker.
- GPS-based location detection.
- Street and satellite map views.
- Exact and approximate location indicators.
- Nearby complaint identification.
- Distance-based duplicate detection.

### Emergency & Crew Coordination
- Automatic crew assignment for Critical complaints.
- Least-loaded crew selection.
- Crew capacity monitoring.
- Suggested crew assignment for other priorities.
- Emergency escalation workflow.

### Citizen Transparency
- Unique complaint reference numbers.
- Complaint tracking timeline.
- Department updates.
- Citizen ratings and reviews.
- Printable acknowledgement receipts.
- Shareable complaint links.

### Analytics & Reporting
- Complaints by category.
- Department workload analysis.
- Severity distribution.
- Geographic complaint hotspots.
- Officer CSV export.
- Citizen satisfaction ratings.

## 6. AI Integration

CivicLens supports two complaint-processing modes.

### Claude-Powered AI
When an Anthropic API key is configured, Claude can provide:
- Complaint classification.
- Structured triage output.
- Photo description and cross-checking.
- AI-assisted complaint processing.

### Offline Rules Engine
When the API key is unavailable or an AI request fails, the application falls back to its rules-based engine.

This allows the application to continue processing supported complaints without depending entirely on an external AI service.

**Current Live Deployment Status:** The deployed Render instance was observed running the offline rules engine. Claude-dependent functionality requires an API key and separate verification before being presented as active in the live demonstration.

## 7. System Architecture

```text
             CITIZEN INTERFACE
                    |
                    |
             Complaint Submission
                    |
                    v
              SERVER.JS
                    |
          +---------+---------+
          |                   |
          v                   v
     CLAUDE AI            RULES ENGINE
  (API configured)       (Offline fallback)
          |                   |
          +---------+---------+
                    |
                    v
               TRIAGE OUTPUT
                    |
          +---------+---------+
          |         |         |
          v         v         v
       CATEGORY  SEVERITY  DEPARTMENT
          |         |         |
          +---------+---------+
                    |
                    v
             PRIORITY ENGINE
                    |
                    v
             TICKET STORAGE
                    |
          +---------+---------+
          |                   |
          v                   v
    OFFICER DASHBOARD    CITIZEN TRACKING
          |
          v
    CREW COORDINATION
          |
          v
     STATUS UPDATES
```

### Main Backend Components

| Component | Responsibility |
|---|---|
| `server.js` | HTTP server and API endpoints |
| `src/triage-ai.js` | Claude-powered triage integration |
| `src/triage-rules.js` | Offline rules-based fallback |
| `src/store.js` | Ticket storage and management |
| `src/taxonomy.js` | Categories, departments, SLA and priority logic |
| `public/` | Citizen and officer interfaces |

## 8. Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | Backend runtime |
| JavaScript | Application logic |
| Anthropic SDK | Optional Claude AI integration |
| Leaflet | Interactive maps |
| OpenStreetMap | Map data |
| Nominatim | Geocoding and location search |
| Chart.js | Analytics visualisation |
| JSON Storage | Prototype ticket storage |
| Render | Cloud deployment |
| GitHub | Source code management |

## 9. Live Demonstration

**Access CivicLens:**

https://civiclens-hm8f.onrender.com

### Suggested Demo Workflow

1. Open the citizen reporting interface.
2. Submit a sample civic complaint.
3. Demonstrate complaint classification and severity.
4. Show department routing.
5. Open the officer dashboard.
6. Demonstrate complaint prioritisation.
7. Show the geographical complaint map.
8. Demonstrate ticket tracking and status updates.
9. Explore analytics and crew management.

### Built-in Demo Scenarios

The application includes sample scenarios demonstrating:
- Kannada-language complaints.
- Critical electrical hazards near schools.
- Duplicate complaint merging.
- Severity assessment of exaggerated complaints.
- Photo and complaint mismatch detection when the Claude engine is enabled.

Use the dashboard's **Load demo data** option to populate sample complaints.

## 10. Installation & Local Setup

### Requirements
- Node.js 20.6 or later.
- npm.

### Clone Repository

```bash
git clone https://github.com/uchathyakg-bit/civiclens.git

cd civiclens
```

### Install Dependencies

```bash
npm install
```

### Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Add your Anthropic API key if you want to enable Claude-powered processing.

### Start Application

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## 11. Testing & Evaluation

CivicLens includes evaluation commands for its complaint-processing engines.

### Evaluate Configured Engine

```bash
npm run eval
```

### Evaluate Offline Rules Engine

```bash
npm run eval:rules
```

The first command uses Claude when configured, otherwise the rules engine.

## 12. Deployment

CivicLens is deployed using Render Web Services.

### Deployment Configuration

| Setting | Configuration |
|---|---|
| Runtime | Node.js |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check | `/health` |

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Optional Claude API key |
| `PORT` | Provided automatically by Render |
| `CIVICLENS_MODEL` | Optional AI model configuration |
| `CIVICLENS_CITY` | City configuration |
| `CIVICLENS_CITY_LAT` | City latitude |
| `CIVICLENS_CITY_LNG` | City longitude |
| `CIVICLENS_GEOCODE` | Geocoding configuration |

Never upload API keys or `.env` files to GitHub.

## 13. Limitations & Future Improvements

CivicLens is currently a functional prototype. The following improvements are required before real municipal deployment.

### Security & Authentication
- Officer authentication.
- Role-based access control.
- Citizen identity verification.
- Secure review moderation.

### Database & Infrastructure
- PostgreSQL and PostGIS integration.
- Persistent cloud storage.
- Image object storage.
- Automated backups.
- Audit logging.

### Communication
- SMS notifications.
- WhatsApp Business integration.
- Automated status updates.
- Citizen notification system.

### AI Improvements
- Larger multilingual evaluation datasets.
- Improved complaint classification.
- Continuous accuracy monitoring.
- Human verification for Critical complaints.
- AI cost monitoring.

### Privacy & Accessibility
- Photo privacy protection.
- Face and number-plate blurring.
- Data retention controls.
- Accessibility improvements.
- Compliance review before real-world deployment.

## 14. Responsible Use

CivicLens is an independent prototype and is not an official government platform.

The configured SLA values are demonstration assumptions, not official municipal commitments.

AI-generated classifications and emergency recommendations require human verification. The application should not be used as the sole basis for public-safety or emergency-response decisions.

## 15. Credits & AI Disclosure

CivicLens was developed during the Prompt to Product event.

AI development assistance:
- Claude (Anthropic).
- Claude Code.

The project integrates the Anthropic SDK for optional AI-powered complaint triage.

Sample complaints were created by the project team.

The development team is responsible for reviewing, testing and understanding the submitted implementation.

---

## CivicLens

**Making citizen complaints easier to report, understand, prioritise and track.**

Live Demo: https://civiclens-hm8f.onrender.com

GitHub: https://github.com/uchathyakg-bit/civiclens


