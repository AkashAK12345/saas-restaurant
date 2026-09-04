# Samco Platform

This is the monorepo for the Samco multi-branch restaurant and hospitality management platform.

## Architecture

This project is structured as a monorepo using Turborepo and npm workspaces.

- `apps/api`: NestJS backend
- `apps/web`: Next.js frontend (Tablet-optimized web app)
- `packages/*`: Shared modules, types, and configurations

## Prerequisites

- Node.js (v20 or higher recommended)
- npm (v10 or higher)
- PostgreSQL

## Getting Started

1. **Install Dependencies**
   From the root of the project, run:
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and configure your local settings:
   ```bash
   cp .env.example .env
   ```

3. **Development Mode**
   Start both the backend API and frontend Web application concurrently:
   ```bash
   npm run dev
   ```

   - Web App will be available at: http://localhost:3000
   - API will be available at: http://localhost:3001

## Scripts

- `npm run dev`: Start all apps in development mode
- `npm run build`: Build all apps and packages
- `npm run lint`: Lint the codebase
- `npm run type-check`: Run TypeScript type checking
- `npm run format`: Format code with Prettier
