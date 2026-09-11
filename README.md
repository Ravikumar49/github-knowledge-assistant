# GitHub Knowledge Assistant

Semantic code search and question answering over indexed GitHub repositories. This full-stack application allows users to submit any public GitHub repository, index its codebase into a vector database using background workers, and ask complex architectural or implementation questions using generative AI.

## Architecture

This project is structured as a monorepo containing a Next.js frontend and a containerized backend microservices architecture designed for cloud deployment.

| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| **Frontend** | Next.js (React) | User interface for submitting repositories and displaying chat interactions. |
| **API Gateway** | Express.js (Node.js) | Handles incoming HTTP requests, manages chat sessions, and orchestrates tasks. |
| **Background Worker** | BullMQ (Node.js) | Asynchronously clones GitHub repositories, chunks source code, and generates embeddings. |
| **Vector Database** | Qdrant | Stores high-dimensional vector embeddings of codebase chunks for semantic search. |
| **Message Broker** | Redis | Manages job queues for the BullMQ workers and handles inter-service communication. |
| **Relational Database**| PostgreSQL | Stores persistent application metadata, chat histories, and repository indexing status. |
| **LLM Provider** | Google Gemini API | Generates vector embeddings and synthesizes final answers based on retrieved context. |

## Core Features

* **Asynchronous Indexing:** Utilizes Redis and BullMQ to handle large repository cloning and parsing in the background without blocking the main API thread.
* **Semantic Code Search:** Converts raw source code into vector embeddings via the Gemini API, enabling context-aware retrieval rather than simple keyword matching.
* **Retrieval-Augmented Generation (RAG):** Feeds relevant codebase chunks directly to Gemini to generate highly accurate, grounded answers to user questions.
* **Cloud-Native Deployment:** Fully containerized using Docker Compose for seamless deployment on AWS EC2 instances.

## Prerequisites

* Docker and Docker Compose
* Node.js (v18+) and `pnpm`
* A Google Gemini API Key
* (For AWS Deployment) An EC2 instance (e.g., `t3.micro` running Ubuntu)

## Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd github-knowledge-assistant
   ```

2. **Set up the backend environment variables:**
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=your_password
   POSTGRES_DB=gka_db
   ```

3. **Start the backend services:**
   ```bash
   docker compose up -d
   ```

4. **Set up the frontend environment variables:**
   Create an `.env.local` file inside the `apps/web` directory:
   ```env
   NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
   ```

5. **Run the Next.js development server:**
   ```bash
   cd apps/web
   pnpm install
   pnpm run dev
   ```

## AWS EC2 Deployment Guide

When deploying this stack to a low-memory cloud instance (like an AWS `t3.micro`), compiling the Node.js Docker containers can exhaust the physical RAM and completely freeze the virtual machine. You must allocate a swap file before running the initial build.

1. **Allocate Virtual Memory (Swap File):**
   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

2. **Deploy the Architecture:**
   ```bash
   sudo docker compose up -d --build
   ```

3. **Connect a Local Frontend to the Live Backend:**
   If you want to run the UI locally but route requests to your cloud infrastructure, update your local `apps/web/.env.local` file to point to your EC2 instance's Public IPv4 address:
   ```env
   NEXT_PUBLIC_API_BASE_URL=http://<YOUR_EC2_PUBLIC_IP>:4000
   ```
   Restart your Next.js server (`pnpm run dev`) to apply the new routing path.
