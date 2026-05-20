# RVK Chatbot UI

A Next.js chatbot application with authentication, chat history, RAG search, localization, and optional local microservices.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- MongoDB / Mongoose
- NextAuth
- Tailwind CSS
- Groq / Gemini / OpenAI-compatible AI integrations
- Optional microservices for auth, thread, chat, LLM, and RAG

## Requirements

Install these before running the project:

- Node.js 20 or newer
- npm
- MongoDB Atlas connection string or local MongoDB
- API keys for the AI providers you want to use
- Docker Desktop, only if running the microservices setup

## Environment Variables

Create a `.env.local` file in the project root.

```env
MONGODB_URI=your_mongodb_connection_string

NEXTAUTH_SECRET=your_random_secret
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret

GROQ_API_KEY=your_groq_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_generative_ai_key
GEMINI_EMBEDDING_MODEL=text-embedding-004

OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key

NEXT_PUBLIC_TOLGEE_API_KEY=your_tolgee_api_key
NEXT_PUBLIC_TOLGEE_API_URL=your_tolgee_api_url

SMTP_HOST=your_smtp_host
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=your_from_email
```

Optional microservice variables:

```env
API_GATEWAY_URL=http://localhost:8080
AUTH_SERVICE_URL=http://localhost:4001
LLM_SERVICE_URL=http://localhost:4004
RAG_SERVICE_URL=http://localhost:4005
RAG_VECTOR_DB=mongodb
RAG_TABLE_NAME=agno_rag_documents
RAG_DB_URL=postgresql+psycopg://rag:rag@localhost:5433/rag
OLLAMA_BASE_URL=http://localhost:11434
```

RAG uses the Agno Knowledge framework. Local microservice runs use the Agno MongoDB vector DB by default through `MONGODB_URI`. Docker Compose sets `RAG_VECTOR_DB=pgvector` and starts a PgVector database for the RAG service.

For normal Vercel deployment, do not set `API_GATEWAY_URL` or `AUTH_SERVICE_URL` unless those services are deployed somewhere public. The app can use the built-in Next.js API route fallback for signup.

## Install

```bash
npm install
```

## Run Locally

Start the Next.js app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Build

```bash
npm run build
```

## Start Production Build Locally

```bash
npm run build
npm run start
```

## Lint

```bash
npm run lint
```

## Run With Local Microservices

Install service dependencies:

```bash
npm run setup:microservices
```

Start only the microservices:

```bash
npm run dev:microservices
```

Start microservices and Next.js together:

```bash
npm run dev:all
```

Run service health checks:

```bash
npm run smoke:microservices
```

Main local service URLs:

```text
API Gateway: http://localhost:8080
Auth Service: http://localhost:4001
Thread Service: http://localhost:4002
Chat Service: http://localhost:4003
LLM Service: http://localhost:4004
RAG Service: http://localhost:4005
```

## Run Microservices With Docker

```bash
docker compose -f docker-compose.microservices.yml up
```

To stop:

```bash
docker compose -f docker-compose.microservices.yml down
```

## Vercel Deployment

Add these environment variables in Vercel Project Settings:

```env
MONGODB_URI=your_mongodb_connection_string
NEXTAUTH_SECRET=your_random_secret
NEXTAUTH_URL=https://your-vercel-domain.vercel.app
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret

GROQ_API_KEY=your_groq_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_generative_ai_key
GEMINI_EMBEDDING_MODEL=text-embedding-004
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key

NEXT_PUBLIC_TOLGEE_API_KEY=your_tolgee_api_key
NEXT_PUBLIC_TOLGEE_API_URL=your_tolgee_api_url

SMTP_HOST=your_smtp_host
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=your_from_email
```

After adding environment variables, redeploy the project.

If MongoDB Atlas is used, make sure Network Access allows Vercel to connect. For quick testing, allow:

```text
0.0.0.0/0
```

## Git Workflow

Use `main` as the primary branch.

```bash
git status
git add .
git commit -m "Your message"
git push origin main
```

## Project Structure

```text
app/                  Next.js app routes and API routes
components/           UI and chat components
lib/                  Shared helpers, database, email, service proxy
models/               Mongoose models
services/             Optional microservices
scripts/              Local microservice setup and smoke test scripts
public/               Static assets
```

## Notes

- `.env.local` is not committed to GitHub.
- Vercel needs environment variables added manually in the dashboard.
- Signup requires a working `MONGODB_URI`.
- Login requires `NEXTAUTH_SECRET` and `NEXTAUTH_URL`.
- OAuth login requires valid Google/GitHub callback URLs.
