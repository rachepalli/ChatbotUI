# AIVA Chatbot UI

AIVA is a Next.js multi-model AI chat workspace with authentication, saved threads, document and image uploads, RAG search, voice input, localization, and optional local microservices.

## Features

- Multi-model chat with Gemini and LLaMA-style providers
- Persistent chat history with pin, archive, rename, and search
- Document and image attachments with RAG-backed answers
- Voice-to-text in the chat composer (browser speech recognition with Whisper fallback)
- Localized UI for English, Hindi, Kannada, Telugu, Tamil, and Malayalam
- Light and dark themes
- Email/password auth plus Google and GitHub OAuth
- Password reset flow with SMTP email support
- Optional microservices for auth, threads, chat, LLM routing, and RAG

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
MONGODB_DIRECT_URI=optional_non_srv_mongodb_seed_list_uri
MONGODB_DB=chatbot

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

SMTP_HOST=your_smtp_host
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=your_from_email
```

`OPENAI_API_KEY` or `GROQ_API_KEY` is required for server-side voice transcription fallback. `SMTP_*` is optional in local development; when SMTP is not configured, the forgot-password flow can return a development reset link instead of sending email.

Optional RAG tuning variables:

```env
RAG_CHAT_MODEL=gemini-2.5-flash
RAG_FALLBACK_CHAT_MODELS=gemini-2.5-flash-lite,gemini-2.5-flash
RAG_TOP_K=6
RAG_SUMMARY_TOP_K=8
RAG_EMBEDDING_DIMENSIONS=768
```

Optional microservice variables:

```env
API_GATEWAY_URL=http://localhost:8080
AUTH_SERVICE_URL=http://localhost:4001
LLM_SERVICE_URL=http://localhost:4004
RAG_SERVICE_URL=http://localhost:4005
RAG_VECTOR_DB=local-mongodb
RAG_TABLE_NAME=agno_rag_documents
RAG_MONGO_SEARCH_INDEX_NAME=vector_index_1
RAG_DB_URL=postgresql+psycopg://rag:rag@localhost:5433/rag
OLLAMA_BASE_URL=http://localhost:11434
```

RAG uses the Agno Knowledge framework. Local microservice runs use a local MongoDB-backed vector store by default through `MONGODB_URI`, because normal local MongoDB does not support Atlas `$vectorSearch`. Use `RAG_VECTOR_DB=mongodb-atlas` only with MongoDB Atlas/Atlas CLI local deployments. Docker Compose sets `RAG_VECTOR_DB=pgvector` and starts a PgVector database for the RAG service.

If your machine or DNS provider blocks Node's SRV lookup for `mongodb+srv://` Atlas URLs, set `MONGODB_DIRECT_URI` to the standard seed-list URI from Atlas. The app and microservices prefer `MONGODB_DIRECT_URI` when it is present, while keeping `MONGODB_URI` available for environments where SRV works.

### MongoDB Atlas RAG

For Vercel or another hosted deployment using MongoDB Atlas Vector Search, set:

```env
MONGODB_URI=your_mongodb_atlas_connection_string
MONGODB_DIRECT_URI=optional_non_srv_mongodb_atlas_seed_list_uri
MONGODB_DB=chatbot
RAG_VECTOR_DB=mongodb-atlas
RAG_TABLE_NAME=agno_rag_documents
RAG_MONGO_SEARCH_INDEX_NAME=vector_index_1
RAG_EMBEDDING_DIMENSIONS=768
```

Create an Atlas Vector Search index on the `agno_rag_documents` collection with:

- Index name: `vector_index_1`
- Vector field path: `embedding`
- Dimensions: `768`
- Similarity: `cosine`
- Filter fields: `meta_data.userId`, `meta_data.threadId`, `meta_data.attachmentId`

Atlas is required for this mode. Plain local MongoDB does not support `$vectorSearch`.

For normal Vercel deployment, do not set `API_GATEWAY_URL` or `AUTH_SERVICE_URL` unless those services are deployed somewhere public. The app can use the built-in Next.js API route fallback for signup.

## Localization

The UI ships with built-in translations for English, Hindi, Kannada, Telugu, Tamil, and Malayalam. Google Translate is used as a page-level fallback through `AppGoogleTranslateProvider`, so users can switch languages from the header without extra third-party translation service keys.

## Voice Input

Voice input is available in the chat composer when signed in:

- Chrome and Edge use the browser Web Speech API for live transcription
- Other browsers record audio and send it to `/api/voice/translate`
- The voice API tries Groq Whisper first, then OpenAI Whisper if Groq is unavailable or quota-limited

Microphone access requires HTTPS or `http://localhost`.

## Upload Limits

The chat UI enforces daily client-side limits of:

- 5 images per day
- 3 documents per day

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
- Voice transcription requires sign-in plus `GROQ_API_KEY` or `OPENAI_API_KEY`.
- Password reset email requires valid `SMTP_*` values in production.
