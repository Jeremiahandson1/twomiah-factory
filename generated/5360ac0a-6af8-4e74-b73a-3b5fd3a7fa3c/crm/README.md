# Twomiah Build CRM

Full-stack construction management system with multi-tenant architecture, real-time updates, and production-ready infrastructure.

## Features

### Core Modules
- **Contacts** - Leads, clients, subcontractors, vendors with conversion workflow
- **Projects** - Full project lifecycle management with budget tracking
- **Jobs** - Scheduling, dispatch, and field status updates
- **Quotes** - Line items, PDF generation, email sending, convert to invoice
- **Invoices** - Payments, balance tracking, PDF generation, status workflow
- **Documents** - File upload with image processing and thumbnails

### Operations
- **Schedule** - Calendar view with drag-and-drop
- **Time Tracking** - Billable hours, approval workflow
- **Expenses** - Categories, receipts, reimbursements
- **RFIs** - Request for information with response workflow
- **Change Orders** - Line items, approval process
- **Punch Lists** - Completion verification
- **Daily Logs** - Weather, crew, work performed
- **Inspections** - Schedule, pass/fail workflow
- **Bids** - Pipeline tracking, win rate analytics

### Technical Features
- **Real-time Updates** - WebSocket-powered live data sync
- **PDF Generation** - Professional quotes and invoices
- **Multi-tenant** - Company isolation with shared infrastructure
- **Accessibility** - WCAG 2.1 AA compliant, screen reader support
- **Mobile Responsive** - Touch-optimized UI for field use
- **Offline Support** - (Coming soon)

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, Tailwind CSS, Socket.io Client |
| **Backend** | Node.js, Express, Socket.io, Prisma |
| **Database** | PostgreSQL 16 |
| **Auth** | JWT with refresh tokens |
| **PDF** | PDFKit |
| **Email** | SendGrid |
| **Testing** | Jest (backend), Vitest (frontend) |
| **CI/CD** | GitHub Actions |
| **Deploy** | Docker, Docker Compose |

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm or yarn

### Development Setup

```bash
# Clone
git clone https://github.com/your-org/twomiah-build.git
cd twomiah-build

# Start PostgreSQL (Docker option)
docker run -d --name twomiah-build-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=twomiah-build \
  -p 5432:5432 \
  postgres:16-alpine

# Backend
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Demo Login
- **Email:** admin@democonstruction.com
- **Password:** demo1234

## Project Structure

```
twomiah-build/
├── backend/
│   ├── src/
│   │   ├── routes/          # API endpoints (18 files)
│   │   ├── middleware/      # Auth, security
│   │   ├── services/        # Email, PDF, Socket, Logger
│   │   └── utils/           # Errors, validation
│   ├── prisma/
│   │   ├── schema.prisma    # Database schema (30+ tables)
│   │   └── seed.js          # Demo data
│   ├── __tests__/           # Jest tests
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/           # 23 route pages
│   │   ├── components/
│   │   │   ├── ui/          # Accessible components
│   │   │   ├── common/      # ErrorBoundary, Skeleton, EmptyState
│   │   │   ├── detail/      # 5 detail pages
│   │   │   └── layout/      # AppLayout, MobileNav
│   │   ├── contexts/        # Auth, Toast, Socket
│   │   ├── hooks/           # useApi, useDebounce, useMediaQuery
│   │   └── services/        # API client
│   ├── src/test/            # Vitest tests
│   ├── Dockerfile
│   └── nginx.conf
├── .github/workflows/       # CI/CD pipeline
├── docker-compose.yml
├── DEPLOYMENT.md
└── README.md
```

## API Overview

| Resource | Endpoints |
|----------|-----------|
| Auth | register, login, me, refresh, forgot-password, reset-password |
| Contacts | CRUD + stats, convert |
| Projects | CRUD + stats |
| Jobs | CRUD + today, start, complete, dispatch |
| Quotes | CRUD + stats, send, approve, reject, convert-to-invoice, pdf |
| Invoices | CRUD + stats, send, payments, pdf |
| Documents | CRUD + upload |
| Time | CRUD + summary, approve |
| Expenses | CRUD + summary, reimburse |
| RFIs | CRUD + respond, close |
| Change Orders | CRUD + submit, approve, reject |
| Punch Lists | CRUD + complete, verify |
| Daily Logs | CRUD |
| Inspections | CRUD + pass, fail |
| Bids | CRUD + stats, submit, won, lost |
| Team | CRUD |
| Company | get, update, features, users |
| Dashboard | stats, recent-activity |

## Testing

```bash
# Backend
cd backend
npm test
npm run test:coverage

# Frontend
cd frontend
npm test
npm run test:coverage
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

### Quick Docker Deploy

```bash
# Build and run
docker-compose up -d --build

# Apply migrations
docker-compose exec backend npx prisma migrate deploy
```

## Environment Variables

### Backend (.env)
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/twomiah-build
JWT_SECRET=your-64-char-secret
JWT_REFRESH_SECRET=your-64-char-refresh-secret
PORT=3001
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
SENDGRID_API_KEY=optional
FROM_EMAIL=noreply@example.com
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
```

## Security Features

- JWT access tokens (15min) + refresh tokens (7 days)
- Password hashing with bcrypt (12 rounds)
- Rate limiting (100 req/15min general, 20 req/15min auth)
- Helmet security headers
- Input sanitization
- SQL injection detection
- CORS configuration
- Request ID tracking
- Audit logging

## Accessibility

- Skip navigation link
- ARIA labels and roles
- Focus management
- Keyboard navigation
- Screen reader announcements
- High contrast support
- Reduced motion support
- Responsive touch targets

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT
