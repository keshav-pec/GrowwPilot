# GrowwPilot

A multi-tenant salon management and CRM SaaS built with MongoDB, Express, React and Node.

> This README grows with the project. The full version (architecture, ER diagram, deployment, AI usage) comes in Phase 15.

## Run it locally

```bash
# 1. API (http://localhost:5699)
cd server
cp .env.example .env   # add your MongoDB Atlas URI and a JWT secret
npm install
npm run seed           # wipes the database and loads demo data
npm run dev

# 2. Web app (http://localhost:5199)
cd client
cp .env.example .env   # API_PROXY_TARGET=http://localhost:5699
npm install
npm run dev
```

Run the backend tests with `npm test` inside `server/`. They use a temporary in-memory MongoDB, never your real database.

## Demo logins

Every account uses the password `Password@123`.

| Role | Email |
|---|---|
| Super Admin | admin@growwpilot.com |
| Owner (Glamour Studio, 2 branches) | owner@glamour.com |
| Front Desk (Glamour Studio, Andheri) | desk.andheri@glamour.com |
| Owner (Desert Rose, Dubai) | owner@desertrose.com |
| Front Desk (Desert Rose, Dubai) | desk@desertrose.com |

## Product and UX decisions

- **The day board is the receptionist's home screen.** It answers "who is free right now?" at a glance: one column per stylist, time running down the page, and one-click buttons to move a booking along (Mark arrived → Start → Complete → Checkout). The **list view** is for searching and filtering (by date, status, stylist, or customer name/phone), and its filters live in the URL so a refresh keeps them.
- **The server decides every booking conflict.** The free times shown in the booking form refresh every 60 seconds and only help the receptionist pick a slot. If two desks book the same stylist at the same moment, the first one to save wins and the other sees *"This slot was just booked by another desk. Please pick another time."*

## Technical decisions (short)

- **Tenant isolation on the server:** the salon (`orgId`) always comes from the logged-in user, never from the request. Another salon's record ids return 404.
- **No double booking:** each booking runs in a MongoDB transaction that first "touches" the stylist's document. Two simultaneous bookings for the same stylist can't both commit; the second is retried and then sees the first.
- **Times are stored in UTC**, and each branch has its own timezone for display and opening hours.
- **Money is stored as whole paise** (₹1,530.50 = `153050`) to avoid rounding errors.
- **Snapshots:** appointments keep a copy of the service name, price and stylist name, so old records stay correct after changes.
